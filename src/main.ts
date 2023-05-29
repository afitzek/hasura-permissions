import { SelectPermission, TableEntry, InsertPermission, UpdatePermission, DeletePermission } from './HasuraMetadataV3';
import { parse, stringify } from 'yaml'
import * as fs from 'fs/promises';
import { join } from 'path';
import { JSONPath } from 'jsonpath-plus';
import * as _ from 'lodash';
import { program } from 'commander';
import { terminal } from 'terminal-kit';

interface TablePermission {
    select?: SelectPermission
    update?: UpdatePermission
    insert?: InsertPermission
    delete?: DeletePermission
}

interface SchemaPermissions {
    [schema: string]: {
        [table: string]: TablePermission
    }
}

interface Role {
    name: string;
    extends?: Array<string>;
    permissions: SchemaPermissions
}

const target_path = (path: string): string => {
    if (path.endsWith('.filter') || path.endsWith('.check')) {
        return `$.permissions.${path}`;
    }

    if (path.endsWith('.update') || path.endsWith('.select') || path.endsWith('.delete')) {
        return `$.permissions.${path}.filter`;
    }

    if (path.endsWith('.insert')) {
        return `$.permissions.${path}.check`;
    }
    return `$.permissions.${path}.select.filter`;
}

const resolve_role = (role: Role): Role => {
    //console.log(`Resolving ${role.name}`);
    JSONPath({
        json: role,
        path: '$..[?(@.__ref_permission)]',
        resultType: 'parent',
        callback: (_p, _t, fullPayload) => {
            //console.log(`Replacing filter`)
            //found = true;
            const path = fullPayload.value["__ref_permission"];
            if (typeof path !== 'string') {
                console.error(`__ref_permission has to be a string!`)
                process.exit(1);
            }
            const replace = JSONPath(target_path(path), role, undefined, undefined)[0];
            //console.log(`Replacing ${path} with ${replace}`)
            fullPayload.parent[fullPayload.parentProperty] = replace;
        }
    });

    return role;
}

const merge_permissions = (new_permissions: SchemaPermissions, role_permissions: SchemaPermissions): SchemaPermissions => {
    for (const schemaName in role_permissions) {
        if (Object.prototype.hasOwnProperty.call(role_permissions, schemaName)) {
            const schema = role_permissions[schemaName];
            for (const tableName in schema) {
                if (Object.prototype.hasOwnProperty.call(schema, tableName)) {
                    const table = schema[tableName];

                    if (!new_permissions[schemaName]) {
                        new_permissions[schemaName] = {}
                    }
                    if (!new_permissions[schemaName][tableName]) {
                        new_permissions[schemaName][tableName] = {}
                    }

                    if (table.select) {
                        new_permissions[schemaName][tableName].select = _.cloneDeep(table.select);
                    }

                    if (table.insert) {
                        new_permissions[schemaName][tableName].insert = _.cloneDeep(table.insert);
                    }

                    if (table.update) {
                        new_permissions[schemaName][tableName].update = _.cloneDeep(table.update);
                    }

                    if (table.delete) {
                        new_permissions[schemaName][tableName].delete = _.cloneDeep(table.delete);
                    }
                }
            }
        }
    }
    return new_permissions;
}

const read_roles = async (hasura_dir: string): Promise<Array<Role>> => {
    const roles_folder = join(hasura_dir, `roles/`);
    const files = await fs.readdir(roles_folder);

    const all_roles: Array<Role> = [];
    const role_map: { [name: string]: Role } = {};

    for (const file of files) {
        const fileName = join(roles_folder, file);
        const role: Role = parse((await fs.readFile(fileName)).toString('utf8'));
        if (typeof role !== 'object' || role.name === undefined) {
            continue;
        }
        if (typeof role.extends === 'string') {
            role.extends = [role.extends];
        }
        role_map[role.name] = role;
        all_roles.push(role);
    }

    let all_resolved = false;
    let resolved_role = false;
    do {
        for (const role of all_roles) {
            if (role.extends) {
                const not_extended_yet = role.extends.find((r) => {
                    const role_to_extend = role_map[r];
                    if (!role_to_extend) {
                        console.error(`Failed to process! Role ${role.name} extends role ${r}, but this was not found!`);
                        process.exit(1);
                    }
                    return role_to_extend.extends !== undefined
                });
                if (not_extended_yet) {
                    // Can't extend yet
                    continue;
                }
                // merge the role_to_extend into role
                const new_permissions = {};
                for (const r of role.extends) {
                    const role_to_extend = role_map[r];
                    merge_permissions(new_permissions, role_to_extend.permissions);
                }
                merge_permissions(new_permissions, role.permissions);
                role.permissions = new_permissions;
                delete role.extends;
                resolved_role = true;
            }
        }
        all_resolved = all_roles.findIndex((r) => r.extends !== undefined) < 0;
        if (!all_resolved && !resolved_role) {
            console.error(`Failed to process! Can't resolve all roles. The following roles can't be resolved in order`,
                all_roles);
            process.exit(1);
        }
    } while (!all_resolved)

    return all_roles.map(resolve_role);
}

const augment_metadata = async (hasura_dir: string, roles: Array<Role>): Promise<Array<TableEntry>> => {

    const tables_folder = join(hasura_dir, `metadata/databases/main/tables/`);
    const files = await fs.readdir(tables_folder);
    const tables: Array<TableEntry> = [];

    for (const file of files) {
        //console.log(`Augmenting ${file}`);
        const fileName = join(hasura_dir, `metadata/databases/main/tables/${file}`);
        const tableEntry: TableEntry = parse((await fs.readFile(fileName)).toString('utf8'));
        if (typeof tableEntry.table !== 'object') {
            //console.log(`Skipping non table file ${file}`);
            continue;
        }

        // reset all permissions
        tableEntry.select_permissions = undefined;
        tableEntry.update_permissions = undefined;
        tableEntry.insert_permissions = undefined;
        tableEntry.delete_permissions = undefined;

        for (const role of roles) {
            const schemaPermissions = role.permissions[tableEntry.table.schema];
            if (schemaPermissions) {
                const tablePermissions = schemaPermissions[tableEntry.table.name];
                if (tablePermissions) {
                    if (tablePermissions.select) {
                        if(!tableEntry.select_permissions) {
                            tableEntry.select_permissions = [];
                        }
                        tableEntry.select_permissions.push({
                            role: role.name,
                            permission: tablePermissions.select
                        });
                    }
                    if (tablePermissions.update) {
                        if(!tableEntry.update_permissions) {
                            tableEntry.update_permissions = [];
                        }
                        tableEntry.update_permissions.push({
                            role: role.name,
                            permission: tablePermissions.update
                        });
                    }
                    if (tablePermissions.insert) {
                        if(!tableEntry.insert_permissions) {
                            tableEntry.insert_permissions = [];
                        }
                        tableEntry.insert_permissions.push({
                            role: role.name,
                            permission: tablePermissions.insert
                        });
                    }
                    if (tablePermissions.delete) {
                        if(!tableEntry.delete_permissions) {
                            tableEntry.delete_permissions = [];
                        }
                        tableEntry.delete_permissions.push({
                            role: role.name,
                            permission: tablePermissions.delete
                        });
                    }
                }
            }
        }

        await fs.writeFile(fileName, stringify(tableEntry));

        tables.push(tableEntry);
    }

    return tables;
}

const main = async () => {
    program
        .version('0.0.1')
        .name("hperm")
        .usage("<dir>")
        .summary("Generate hasura permissions")
        .description(`Generate hasura metadata based on
extended vocabulary for permissions.`)
        .argument('<dir>', 'The hasura directory')
        .action(async (dir) => {
            terminal("Generating hasura metadata in ").bold(`${dir}\n\n`);
            const spinner = await terminal.spinner('dotSpinner');
            terminal(" Reading roles ...")
            await new Promise(r => setTimeout(r, 1000));
            const roles = await read_roles(dir);
            terminal('\n')
            spinner.animate(false);

            terminal("\nFound ").bold(`${roles.length}`);
            terminal(" roles: \n");
            terminal.table([
                ['Name'],
                ...roles.map((v) => {
                    return [
                        v.name
                    ]
                })
            ], {
                hasBorder: true,
                contentHasMarkup: true,
                borderChars: 'lightRounded',
                borderAttr: { color: 'blue' },
                textAttr: { bgColor: 'default' },
                firstRowTextAttr: { bold: true, underline: true } ,
                width: 80,
                fit: true   // Activate all expand/shrink + wordWrap
            }
            );

            terminal('\n')
            const augment = await terminal.spinner('dotSpinner');
            terminal(" Generating metadata ...")
            const tables = await augment_metadata(dir, roles);
            terminal('\n')
            augment.animate(false);

            terminal("\nGenerated ").bold(`${tables.length}`);

            terminal(' tables\n')

            terminal.table([
                ['Name'],
                ...tables.map((v) => {
                    return [
                        `${v.table.schema}.${v.table.name}`
                    ]
                })
            ], {
                hasBorder: true,
                contentHasMarkup: true,
                borderChars: 'lightRounded',
                borderAttr: { color: 'blue' },
                textAttr: { bgColor: 'default' },
                firstRowTextAttr: { bold: true, underline: true } ,
                width: 80,
                fit: true   // Activate all expand/shrink + wordWrap
            }
            );
            terminal('\n')

            terminal.bold.green("\nAll done\n");
        })

    program.parse();

};

main().catch((e) => {
    console.error(`Something went badly wrong ...`, e);
});