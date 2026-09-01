-- Fastify may persist a validated/manual inbound customer response while the
-- browser and PostgREST roles remain unable to write CLOSER production data.

GRANT INSERT ON TABLE messages TO closer_api;
