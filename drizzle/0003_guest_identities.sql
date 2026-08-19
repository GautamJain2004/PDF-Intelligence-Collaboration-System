CREATE TABLE "guest_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_identities_email_unique" ON "guest_identities" USING btree ("email");--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_identity_id_guest_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."guest_identities"("id") ON DELETE set null ON UPDATE no action;