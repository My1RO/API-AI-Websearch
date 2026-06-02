import "reflect-metadata";
import { DataSource } from "typeorm";

import { env } from "../config/env";
import { SafeFeedbackTables2026060200010 } from "../migrations/2026060200010-SafeFeedbackTables";
import { DropFeedbackOptionalNote2026060200020 } from "../migrations/2026060200020-DropFeedbackOptionalNote";

export const aiWebsearchMigrations = [
  SafeFeedbackTables2026060200010,
  DropFeedbackOptionalNote2026060200020
];

export const createAiWebsearchDataSource = (): DataSource =>
  new DataSource({
    type: "mysql",
    host: env.mysql.host,
    port: env.mysql.port,
    username: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.database,
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: "none",
    logging: false,
    entities: [],
    migrations: aiWebsearchMigrations,
    migrationsTableName: "ai_websearch_typeorm_migrations"
  });

export const AppDataSource = createAiWebsearchDataSource();

export const getDataSource = async (): Promise<DataSource> => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  return AppDataSource;
};

export const closeDataSource = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
};
