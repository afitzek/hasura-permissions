CREATE TABLE "user"
(
    "id"   UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255)     NOT NULL,
    CONSTRAINT "uk_user_name" UNIQUE ("name")
);

CREATE TABLE "container"
(
    "id"   UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255)     NOT NULL,
    CONSTRAINT "uk_container_name" UNIQUE ("name")
);

CREATE TABLE "user_can_access_container"
(
    "user_id"      UUID NOT NULL,
    "container_id" UUID NOT NULL,
    CONSTRAINT "pk_user_can_access_container" PRIMARY KEY ("user_id", "container_id"),
    CONSTRAINT "fk_user_can_access_container_container" FOREIGN KEY ("container_id")
        REFERENCES "container" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_user_can_access_container_user" FOREIGN KEY ("user_id")
        REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "package"
(
    "id"           UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID             NOT NULL,
    "name"         VARCHAR(255)     NOT NULL,
    CONSTRAINT "fk_package_container" FOREIGN KEY ("container_id")
        REFERENCES "container" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "tag"
(
    "id"         UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "package_id" UUID             NOT NULL,
    "key"        TEXT             NOT NULL,
    "value"      TEXT             NOT NULL,
    CONSTRAINT "fk_tag_package" FOREIGN KEY ("package_id")
        REFERENCES "package" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);