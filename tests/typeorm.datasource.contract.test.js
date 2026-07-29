const {
  aiWebsearchMigrations,
  createAiWebsearchDataSource
} = require("../src/db/data-source");

describe("TypeORM datasource contract", () => {
  it("uses explicit migrations with synchronize disabled", () => {
    const dataSource = createAiWebsearchDataSource();

    expect(dataSource.options).toEqual(
      expect.objectContaining({
        type: "mysql",
        synchronize: false,
        migrationsRun: false,
        migrationsTransactionMode: "none",
        migrationsTableName: "ai_websearch_typeorm_migrations"
      })
    );
    expect(dataSource.options.entities).toEqual([]);
    expect(aiWebsearchMigrations.map((migration) => migration.name)).toEqual([
      "SafeFeedbackTables2026060200010"
    ]);
  });
});
