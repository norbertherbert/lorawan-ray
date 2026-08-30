-- CONFIGURATION
-- Replace every occurrence of each placeholder below before running this
-- schema as a database owner in Surrealist:
--
--   __SURREAL_JWT_SECRET__  JWT signing secret shared with the auth worker
--   __TOKEN_ISSUER__        expected JWT issuer (iss)
--   __TOKEN_AUDIENCE__      expected JWT audience (aud)
--   __ADMIN_EMAIL__         Google email address of the administrator
--
-- Never commit the resulting secret-bearing file.
USE NS lorawan DB ray;

DEFINE TABLE OVERWRITE user SCHEMAFULL
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR update WHERE $auth.is_admin = true
    FOR create NONE
    FOR delete WHERE $auth.is_admin = true AND id != $auth.id;

DEFINE FIELD OVERWRITE google_sub ON TABLE user TYPE string
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE email ON TABLE user TYPE string
  ASSERT string::is_email($value)
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE name ON TABLE user TYPE string
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE picture ON TABLE user TYPE option<string>
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE created_at ON TABLE user TYPE datetime DEFAULT time::now()
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE last_login ON TABLE user TYPE datetime
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE FIELD OVERWRITE approved ON TABLE user TYPE bool DEFAULT false
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create NONE
    FOR update WHERE $auth.is_admin = true;
DEFINE FIELD OVERWRITE approved_at ON TABLE user TYPE option<datetime>
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create NONE
    FOR update WHERE $auth.is_admin = true;
DEFINE FIELD OVERWRITE is_admin ON TABLE user TYPE bool DEFAULT false
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR create, update NONE;
DEFINE INDEX OVERWRITE user_google_sub ON TABLE user FIELDS google_sub UNIQUE;
DEFINE INDEX OVERWRITE user_email ON TABLE user FIELDS email UNIQUE;

DEFINE TABLE OVERWRITE invitation SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete WHERE $auth.is_admin = true;

DEFINE FIELD OVERWRITE email ON TABLE invitation TYPE string
  ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE token_hash ON TABLE invitation TYPE string
  ASSERT string::len($value) = 43;
DEFINE FIELD OVERWRITE status ON TABLE invitation TYPE string DEFAULT "pending"
  ASSERT $value IN ["pending", "accepted", "revoked"];
DEFINE FIELD OVERWRITE expires_at ON TABLE invitation TYPE datetime;
DEFINE FIELD OVERWRITE invited_by ON TABLE invitation TYPE record<user>
  DEFAULT $auth.id READONLY;
DEFINE FIELD OVERWRITE accepted_by ON TABLE invitation TYPE option<record<user>>;
DEFINE FIELD OVERWRITE created_at ON TABLE invitation TYPE datetime
  DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE accepted_at ON TABLE invitation TYPE option<datetime>;
DEFINE INDEX OVERWRITE invitation_token_hash ON TABLE invitation FIELDS token_hash UNIQUE;
DEFINE INDEX OVERWRITE invitation_email_status ON TABLE invitation FIELDS email, status;

-- Keep registration configuration private from ordinary record users while
-- allowing administrators to view and change it from the web UI. If this
-- singleton record does not exist, registration remains approval-based.
DEFINE TABLE OVERWRITE auth_config SCHEMAFULL
  PERMISSIONS
    FOR select, create, update WHERE $auth.is_admin = true
    FOR delete NONE;
DEFINE FIELD OVERWRITE open_registration ON TABLE auth_config TYPE bool
  DEFAULT false;

-- Saved Sniffer and PER dataset filters. Shared filters are visible to every
-- approved record user; only the owner can modify or delete a filter.
DEFINE TABLE OVERWRITE saved_filter SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.approved = true
      AND (owner = $auth.id OR visibility = "shared")
    FOR create WHERE $auth.approved = true AND owner = $auth.id
    FOR update, delete WHERE $auth.approved = true AND owner = $auth.id;

DEFINE FIELD OVERWRITE name ON TABLE saved_filter TYPE string
  ASSERT string::len(string::trim($value)) >= 1
    AND string::len(string::trim($value)) <= 80;
DEFINE FIELD OVERWRITE description ON TABLE saved_filter TYPE option<string>
  ASSERT $value IS NONE OR string::len($value) <= 500;
DEFINE FIELD OVERWRITE visibility ON TABLE saved_filter TYPE string
  ASSERT $value IN ["private", "shared"];
DEFINE FIELD OVERWRITE owner ON TABLE saved_filter TYPE record<user>
  DEFAULT $auth.id READONLY;
DEFINE FIELD OVERWRITE owner_name ON TABLE saved_filter TYPE string
  READONLY VALUE ($auth.name ?? $auth.email ?? "Unknown user");
DEFINE FIELD OVERWRITE definition ON TABLE saved_filter TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE definition.type ON TABLE saved_filter TYPE string
  ASSERT $value IN ["sniffer", "per"];
DEFINE FIELD OVERWRITE definition.version ON TABLE saved_filter TYPE int
  ASSERT $value = 1;
DEFINE FIELD OVERWRITE created_at ON TABLE saved_filter TYPE datetime
  DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE updated_at ON TABLE saved_filter TYPE datetime
  VALUE time::now();

DEFINE INDEX OVERWRITE saved_filter_owner ON TABLE saved_filter FIELDS owner;
DEFINE INDEX OVERWRITE saved_filter_visibility ON TABLE saved_filter FIELDS visibility;

DEFINE ACCESS OVERWRITE google ON DATABASE TYPE RECORD
  WITH JWT ALGORITHM HS512 KEY "__SURREAL_JWT_SECRET__"
  AUTHENTICATE {
    IF $token.iss != "__TOKEN_ISSUER__" {
      THROW "Invalid token issuer";
    };
    IF $token.aud != "__TOKEN_AUDIENCE__" {
      THROW "Invalid token audience";
    };
    IF $token.email_verified != true OR $token.sub IS NONE OR $token.email IS NONE {
      THROW "Incomplete identity";
    };

    LET $user = type::record("user", string::concat("google_", $token.sub));
    IF auth_config:registration.open_registration = true {
      UPSERT ONLY $user MERGE {
        google_sub: $token.sub,
        email: $token.email,
        name: $token.name,
        picture: $token.picture,
        last_login: time::now(),
        approved: true,
        approved_at: time::now()
      };
    } ELSE {
      UPSERT ONLY $user MERGE {
        google_sub: $token.sub,
        email: $token.email,
        name: $token.name,
        picture: $token.picture,
        last_login: time::now()
      };
    };

    IF string::lowercase(string::trim($token.email)) =
       string::lowercase("__ADMIN_EMAIL__") {
      UPSERT ONLY $user MERGE {
        approved: true,
        approved_at: time::now(),
        is_admin: true
      };
    };

    IF $token.invitation_hash IS NOT NONE {
      LET $invitation = array::first(
        SELECT * FROM invitation
        WHERE token_hash = $token.invitation_hash
          AND email = string::lowercase(string::trim($token.email))
          AND status = "pending"
          AND expires_at > time::now()
        LIMIT 1
      );

      IF $invitation IS NOT NONE {
        UPSERT ONLY $user MERGE {
          approved: true,
          approved_at: time::now()
        };
        UPDATE ONLY $invitation SET
          status = "accepted",
          accepted_by = $user,
          accepted_at = time::now();
      };
    };

    RETURN $user;
  }
  DURATION FOR SESSION 1h;

-- Backfill the approval fields on records created before this schema version.
UPDATE user SET approved = false WHERE approved IS NONE;
UPDATE user SET is_admin = false WHERE is_admin IS NONE;

-- The administrator must already have signed in at least once.
UPDATE user SET
  approved = true,
  approved_at = time::now(),
  is_admin = true
WHERE string::lowercase(email) = string::lowercase("__ADMIN_EMAIL__");
