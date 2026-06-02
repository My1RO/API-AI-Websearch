import { AppDataSource } from "./data-source";

type MigrationCommand = "up" | "down";

const parseCommand = (): MigrationCommand => {
  const command = (process.argv[2] || "up").toLowerCase();

  if (command === "up" || command === "run") {
    return "up";
  }

  if (command === "down" || command === "revert") {
    return "down";
  }

  throw new Error(`Unsupported migration command "${command}". Use "up" or "down".`);
};

const run = async (): Promise<void> => {
  const command = parseCommand();

  await AppDataSource.initialize();

  if (command === "up") {
    const migrations = await AppDataSource.runMigrations({ transaction: "none" });
    if (migrations.length === 0) {
      console.log("No pending TypeORM migrations.");
      return;
    }

    migrations.forEach((migration) => console.log(`Executed TypeORM migration ${migration.name}`));
    return;
  }

  await AppDataSource.undoLastMigration({ transaction: "none" });
  console.log("Reverted last TypeORM migration.");
};

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });
