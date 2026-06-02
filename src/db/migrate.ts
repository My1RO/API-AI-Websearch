import fs from "node:fs/promises";
import path from "node:path";

import { pool } from "./mysql";

const run = async (): Promise<void> => {
  const migrationsDirectory = path.join(__dirname, "../migrations");
  const files = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_websearch_migrations (
      id INT AUTO_INCREMENT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE INDEX UNIQ_AI_WEBSEARCH_MIGRATION_FILENAME (filename),
      PRIMARY KEY (id)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE = InnoDB
  `);

  for (const file of files) {
    const [rows] = await pool.query("SELECT id FROM ai_websearch_migrations WHERE filename = ?", [file]);
    if (Array.isArray(rows) && rows.length > 0) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDirectory, file), "utf8");
    const statements = sql
      .split(/;\s*$/m)
      .map((statement) => statement.trim())
      .filter(Boolean);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query("INSERT INTO ai_websearch_migrations (filename) VALUES (?)", [file]);
      await connection.commit();
      console.log(`Executed migration ${file}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
};

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
