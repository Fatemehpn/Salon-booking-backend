import { Pool } from "pg";
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('connect', (client) => {
  client.query('SET search_path TO public');
});