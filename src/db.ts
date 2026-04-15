import { Pool } from "pg";
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

export const pool = new Pool({
  connectionString: 'postgresql://postgres.dcvenxfzqslbngohlhom:1wk6rmIr9j11DdXE@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

pool.on('connect', (client) => {
  client.query('SET search_path TO public');
});