-- Run this as a database owner in Surrealist after replacing the three
-- __PLACEHOLDER__ values. Never commit the resulting secret-bearing file.
USE NS main DB main;

DEFINE TABLE OVERWRITE user SCHEMAFULL
  PERMISSIONS
    FOR select, update WHERE id = $auth.id
    FOR create, delete NONE;

DEFINE FIELD OVERWRITE google_sub ON TABLE user TYPE string READONLY;
DEFINE FIELD OVERWRITE email ON TABLE user TYPE string ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE name ON TABLE user TYPE string;
DEFINE FIELD OVERWRITE picture ON TABLE user TYPE option<string>;
DEFINE FIELD OVERWRITE created_at ON TABLE user TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE last_login ON TABLE user TYPE datetime;
DEFINE INDEX OVERWRITE user_google_sub ON TABLE user FIELDS google_sub UNIQUE;

DEFINE TABLE OVERWRITE todo SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete WHERE owner = $auth.id;

DEFINE FIELD OVERWRITE title ON TABLE todo TYPE string
  ASSERT string::len($value) > 0 AND string::len($value) <= 120;
DEFINE FIELD OVERWRITE done ON TABLE todo TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE owner ON TABLE todo TYPE record<user> DEFAULT $auth.id READONLY;
DEFINE FIELD OVERWRITE created_at ON TABLE todo TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE updated_at ON TABLE todo TYPE datetime VALUE time::now();
DEFINE INDEX OVERWRITE todo_owner_created ON TABLE todo FIELDS owner, created_at;

DEFINE ACCESS OVERWRITE google ON DATABASE TYPE RECORD
  WITH JWT ALGORITHM HS512 KEY "__SURREAL_JWT_SECRET__"
  AUTHENTICATE {
    IF $token.iss != "__TOKEN_ISSUER__" {
      THROW "Invalid token issuer";
    };
    IF $token.aud != "__TOKEN_AUDIENCE__" {
      THROW "Invalid token audience";
    };
    IF $token.email_verified != true OR $token.sub IS NONE {
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
    RETURN $user;
  }
  DURATION FOR SESSION 1h;
