#!/bin/sh
# One Postgres instance for local development, one database and one role per service.
# Runs only when the data volume is empty (first `docker compose up`).
# Passwords come from architecture/.env (created by `task env`), never from this repository.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v ledger_pw="$LEDGER_DB_PASSWORD" \
  -v profile_pw="$PROFILE_DB_PASSWORD" \
  -v payment_pw="$PAYMENT_DB_PASSWORD" <<'SQL'
CREATE ROLE ledger WITH LOGIN PASSWORD :'ledger_pw';
CREATE DATABASE ledger OWNER ledger;

CREATE ROLE profile_svc WITH LOGIN PASSWORD :'profile_pw';
CREATE DATABASE profile OWNER profile_svc;

CREATE ROLE payment_svc WITH LOGIN PASSWORD :'payment_pw';
CREATE DATABASE payment OWNER payment_svc;
SQL
