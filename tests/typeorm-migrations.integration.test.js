const mysql = require("mysql2/promise");
const { DataSource } = require("typeorm");
const { aiWebsearchMigrations } = require("../src/db/data-source");

const shouldRunIntegration = process.env.AI_WEBSEARCH_DB_INTEGRATION_TEST === "true";
const describeDb = shouldRunIntegration ? describe : describe.skip;

const adminConfig = () => ({
  host: process.env.AI_WEBSEARCH_TEST_MYSQL_HOST || process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.AI_WEBSEARCH_TEST_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.AI_WEBSEARCH_TEST_MYSQL_USER || process.env.MYSQL_USER || "root",
  password: process.env.AI_WEBSEARCH_TEST_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "g00gle",
  multipleStatements: false
});

const temporaryDatabaseName = () => `api_ai_websearch_typeorm_test_${process.pid}_${Date.now()}`;

describeDb("TypeORM migrations against MySQL", () => {
  let adminConnection;
  let dataSource;
  let databaseName;

  const providerTables = async () => {
    const rows = await dataSource.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name LIKE 'ai_provider_%'
      ORDER BY table_name
    `);

    return rows.map((row) => row.TABLE_NAME || row.table_name);
  };

  const hasColumn = async (tableName, columnName) => {
    const rows = await dataSource.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName]
    );

    return rows.length > 0;
  };

  beforeAll(async () => {
    databaseName = temporaryDatabaseName();
    adminConnection = await mysql.createConnection(adminConfig());
    await adminConnection.query(
      `CREATE DATABASE \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    dataSource = new DataSource({
      type: "mysql",
      host: adminConfig().host,
      port: adminConfig().port,
      username: adminConfig().user,
      password: adminConfig().password,
      database: databaseName,
      synchronize: false,
      migrationsRun: false,
      migrationsTransactionMode: "none",
      logging: false,
      entities: [],
      migrations: aiWebsearchMigrations,
      migrationsTableName: "ai_websearch_typeorm_migrations"
    });

    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    if (adminConnection) {
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await adminConnection.end();
    }
  });

  it("runs up migrations, supports safe writes, and reverts back down", async () => {
    const migrations = await dataSource.runMigrations({ transaction: "none" });
    expect(migrations.map((migration) => migration.name)).toEqual([
      "SafeFeedbackTables2026060200010"
    ]);

    expect(await providerTables()).toEqual([
      "ai_provider_fact_consensus",
      "ai_provider_fact_feedback_counts",
      "ai_provider_phone_call_counts"
    ]);
    expect(await hasColumn("ai_provider_fact_feedback_counts", "optional_note")).toBe(false);
    expect(await hasColumn("ai_provider_fact_feedback_counts", "submitter_class")).toBe(true);
    expect(await hasColumn("ai_provider_fact_feedback_counts", "created_at")).toBe(false);
    expect(await hasColumn("ai_provider_fact_feedback_counts", "feedback_day")).toBe(true);

    await dataSource.query(
      `INSERT INTO ai_provider_fact_feedback_counts
        (aggregation_key, broker_org_id, submitter_class, provider_npi, provider_id, fact_type, normalized_fact_value, validation_status, reason_code, feedback_day, feedback_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE feedback_count = feedback_count + 1`,
      ["a".repeat(64), "broker-1", "producer", "1234567890", "provider-123", "phone", "+12164442200", "correct", "accurate", "2026-07-28"]
    );
    await dataSource.query(
      `INSERT INTO ai_provider_fact_feedback_counts
        (aggregation_key, broker_org_id, submitter_class, provider_npi, provider_id, fact_type, normalized_fact_value, validation_status, reason_code, feedback_day, feedback_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE feedback_count = feedback_count + 1`,
      ["a".repeat(64), "broker-1", "producer", "1234567890", "provider-123", "phone", "+12164442200", "correct", "accurate", "2026-07-28"]
    );
    await dataSource.query(
      `INSERT INTO ai_provider_phone_call_counts
        (aggregation_key, broker_org_id, provider_npi, provider_id, normalized_phone, click_day, click_count)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE click_count = click_count + 1`,
      ["b".repeat(64), "broker-1", "1234567890", "provider-123", "+12164442200", "2026-07-28"]
    );

    const feedbackRows = await dataSource.query("SELECT broker_org_id, submitter_class, normalized_fact_value, DATE_FORMAT(feedback_day, '%Y-%m-%d') AS feedback_day, feedback_count FROM ai_provider_fact_feedback_counts");
    const phoneRows = await dataSource.query("SELECT broker_org_id, normalized_phone, DATE_FORMAT(click_day, '%Y-%m-%d') AS click_day, click_count FROM ai_provider_phone_call_counts");
    expect(feedbackRows).toEqual([{ broker_org_id: "broker-1", submitter_class: "producer", normalized_fact_value: "+12164442200", feedback_day: "2026-07-28", feedback_count: 2 }]);
    expect(phoneRows).toEqual([{ broker_org_id: "broker-1", normalized_phone: "+12164442200", click_day: "2026-07-28", click_count: 1 }]);

    await dataSource.undoLastMigration({ transaction: "none" });
    expect(await providerTables()).toEqual([]);

    const remainingMigrations = await dataSource.query("SELECT name FROM ai_websearch_typeorm_migrations");
    expect(remainingMigrations).toEqual([]);
  });
});
