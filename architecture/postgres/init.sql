-- One Postgres instance for local development, one database and one role per service.
-- Runs only when the data volume is empty (first `docker compose up`).

CREATE ROLE ledger WITH LOGIN PASSWORD 'ledger';
CREATE DATABASE ledger OWNER ledger;

CREATE ROLE customer_svc WITH LOGIN PASSWORD 'customer_svc';
CREATE DATABASE customer OWNER customer_svc;

CREATE ROLE payment_svc WITH LOGIN PASSWORD 'payment_svc';
CREATE DATABASE payment OWNER payment_svc;
