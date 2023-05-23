CREATE TABLE "org"."garment_belongs_to_collection" ("garment_id" integer NOT NULL, "collection_id" Integer NOT NULL, PRIMARY KEY ("garment_id","collection_id") , FOREIGN KEY ("collection_id") REFERENCES "org"."collection"("id") ON UPDATE cascade ON DELETE cascade, FOREIGN KEY ("garment_id") REFERENCES "org"."garment"("id") ON UPDATE cascade ON DELETE cascade);
