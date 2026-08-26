-- Run this as a database owner in Surrealist after replacing the four
-- __PLACEHOLDER__ values. Never commit the resulting secret-bearing file.
USE NS lorawan DB sniffer;

DEFINE TABLE OVERWRITE user SCHEMAFULL
  PERMISSIONS
    FOR select WHERE id = $auth.id OR $auth.is_admin = true
    FOR update WHERE $auth.is_admin = true
    FOR create, delete NONE;

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
    UPSERT ONLY $user MERGE {
      google_sub: $token.sub,
      email: $token.email,
      name: $token.name,
      picture: $token.picture,
      last_login: time::now()
    };

    IF string::lowercase(string::trim($token.email)) =
       string::lowercase("__ADMIN_EMAIL__") {
      UPDATE ONLY $user SET
        approved = true,
        approved_at = time::now(),
        is_admin = true;
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
        UPDATE ONLY $user SET approved = true, approved_at = time::now();
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
