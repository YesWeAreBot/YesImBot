import { PGlite, PGliteOptions } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { Binary, Dict, difference, isNullable, makeArray, pick } from "cosmokit";
import { Driver, Eval, executeUpdate, Field, Selection, z } from "minato";
import { isBracketed } from "@minatojs/sql-utils";
import { escapeId, formatTime, PGliteBuilder } from "./builder";
import zhCN from "./locales/zh-CN.yml";
import enUS from "./locales/en-US.yml";

interface ColumnInfo {
    table_catalog: string;
    table_schema: string;
    table_name: string;
    column_name: string;
    ordinal_position: number;
    column_default: any;
    is_nullable: string;
    data_type: string;
    character_maximum_length: number;
    numeric_precision: number;
    numeric_scale: number;
    is_identity: string;
    is_updatable: string;
}

interface ConstraintInfo {
    constraint_catalog: string;
    constraint_schema: string;
    constraint_name: string;
    table_catalog: string;
    table_schema: string;
    table_name: string;
    constraint_type: string;
    is_deferrable: string;
    initially_deferred: string;
    enforced: string;
    nulls_distinct: string;
}

interface IndexInfo {
    schemaname: string;
    tablename: string;
    indexname: string;
    tablespace: string;
    indexdef: string;
}

interface TableInfo {
    table_catalog: string;
    table_schema: string;
    table_name: string;
    table_type: string;
    self_referencing_column_name: null;
    reference_generation: null;
    user_defined_type_catalog: null;
    user_defined_type_schema: null;
    user_defined_type_name: null;
    is_insertable_into: string;
    is_typed: string;
    commit_action: null;
}

interface QueryTask {
    sql: string;
    resolve: (value: any) => void;
    reject: (reason: unknown) => void;
}

const timeRegex = /(\d+):(\d+):(\d+)(\.(\d+))?/;

function createIndex(keys: string | string[]) {
    return makeArray(keys).map(escapeId).join(", ");
}

export class PGliteDriver extends Driver<PGliteDriver.Config> {
    static name = "pglite";

    public pglite!: PGlite;
    public sql = new PGliteBuilder(this);

    private session?: any; // PGlite transaction object
    private _counter = 0;
    private _queryTasks: QueryTask[] = [];

    async start() {
        // Only create directory for file:// dataDir in Node.js environment
        if (this.config.dataDir && typeof process !== "undefined" && process.versions?.node) {
            try {
                const { mkdirSync } = await import("fs");
                const dataDir = this.config.dataDir.startsWith("file://") ? this.config.dataDir.slice(7) : this.config.dataDir;
                mkdirSync(dataDir, { recursive: true });
            } catch (error) {
                // Ignore if we can't import fs (browser environment)
            }
        }

        // Use PGlite.create to ensure proper initialization
        this.pglite = await PGlite.create({
            ...this.config,
            extensions: {
                vector,
            },
        });

        await this.pglite.query("CREATE EXTENSION IF NOT EXISTS vector");

        this.define<object, object>({
            types: ["json"],
            dump: (value) => value,
            load: (value) => value,
        });

        this.define<Date, string>({
            types: ["time"],
            dump: (date) => (date ? (typeof date === "string" ? date : formatTime(date)) : null),
            load: (str) => {
                if (isNullable(str)) return str;
                const date = new Date(0);
                const parsed = timeRegex.exec(str);
                if (!parsed) throw Error(`unexpected time value: ${str}`);
                date.setHours(+parsed[1], +parsed[2], +parsed[3], +(parsed[5] ?? 0));
                return date;
            },
        });

        this.define<ArrayBuffer, ArrayBuffer>({
            types: ["binary"],
            dump: (value) => value,
            load: (value) => (isNullable(value) ? value : Binary.fromSource(value)),
        });

        this.define<number, number>({
            types: Field.number as any,
            dump: (value) => value,
            load: (value) => (isNullable(value) ? value : +value),
        });

        this.define<bigint, string>({
            types: ["bigint"],
            dump: (value) => (isNullable(value) ? value : value.toString()),
            load: (value) => (isNullable(value) ? value : BigInt(value)),
        });
    }

    async stop() {
        await this.pglite.close();
    }

    async query<T extends any[] = any[]>(sql: string): Promise<T> {
        const result = await (this.session ? this.session.query(sql) : this.pglite.query(sql));
        return result.rows as T;
    }

    queue<T extends any[] = any[]>(sql: string, values?: any): Promise<T> {
        if (this.session) {
            return this.query(sql);
        }

        return new Promise<any>((resolve, reject) => {
            this._queryTasks.push({ sql, resolve, reject });
            process.nextTick(() => this._flushTasks());
        });
    }

    private async _flushTasks() {
        const tasks = this._queryTasks;
        if (!tasks.length) return;
        this._queryTasks = [];

        try {
            // Execute all SQL statements at once using exec for multi-statement support
            const results = await this.pglite.exec(tasks.map((task) => task.sql).join(";\n"));
            if (tasks.length === 1) {
                tasks[0].resolve(results[results.length - 1].rows);
            } else {
                tasks.forEach((task, index) => {
                    task.resolve(results[index]?.rows || []);
                });
            }
        } catch (error) {
            tasks.forEach((task) => task.reject(error));
        }
    }

    async prepare(name: string) {
        const [columns, constraints] = await Promise.all([
            this.queue<ColumnInfo[]>(
                `SELECT * FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${this.sql.escape(name)}`
            ),
            this.queue<ConstraintInfo[]>(
                `SELECT * FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name = ${this.sql.escape(name)}`
            ),
        ]);

        const table = this.model(name);
        const { primary, foreign } = table;
        const fields = { ...table.avaiableFields() };
        const unique = [...table.unique];
        const create: string[] = [];
        const update: string[] = [];
        const rename: string[] = [];

        // field definitions
        for (const key in fields) {
            const { initial, nullable = true } = fields[key]!;
            const legacy = [key, ...(fields[key]!.legacy || [])];
            const column = columns.find((info) => legacy.includes(info.column_name));
            let shouldUpdate = column?.column_name !== key;
            const field = Object.assign({ autoInc: primary.includes(key) && table.autoInc }, fields[key]!);
            const typedef = this.getTypeDef(field);
            if (column && !shouldUpdate) {
                shouldUpdate = this.isDefUpdated(field, column, typedef);
            }

            if (!column) {
                create.push(
                    `${escapeId(key)} ${typedef} ${makeArray(primary).includes(key) || !nullable ? "not null" : "null"}` +
                        (!primary.includes(key) && !isNullable(initial) ? " DEFAULT " + this.sql.escape(initial, fields[key]) : "")
                );
            } else if (shouldUpdate) {
                if (column.column_name !== key) rename.push(`RENAME ${escapeId(column.column_name)} TO ${escapeId(key)}`);
                update.push(`ALTER ${escapeId(key)} TYPE ${typedef}`);
                update.push(`ALTER ${escapeId(key)} ${makeArray(primary).includes(key) || !nullable ? "SET" : "DROP"} NOT NULL`);
                if (!isNullable(initial)) update.push(`ALTER ${escapeId(key)} SET DEFAULT ${this.sql.escape(initial, fields[key])}`);
            }
        }

        // index definitions
        if (!columns.length) {
            create.push(`PRIMARY KEY (${createIndex(primary)})`);
            for (const key in foreign) {
                const [table, key2] = foreign[key]!;
                create.push(`FOREIGN KEY (${escapeId(key)}) REFERENCES ${escapeId(table)} (${escapeId(key2)})`);
            }
        }

        for (const key of unique) {
            let oldIndex: ConstraintInfo | undefined;
            let shouldUpdate = false;
            const oldKeys = makeArray(key).map((key) => {
                const legacy = [key, ...(fields[key]!.legacy || [])];
                const column = columns.find((info) => legacy.includes(info.column_name));
                if (column?.column_name !== key) shouldUpdate = true;
                return column?.column_name;
            });
            if (oldKeys.every(Boolean)) {
                const name = `unique:${table.name}:` + oldKeys.join("+");
                oldIndex = constraints.find((info) => info.constraint_name === name);
            }
            const name = `unique:${table.name}:` + makeArray(key).join("+");
            if (!oldIndex) {
                create.push(`CONSTRAINT ${escapeId(name)} UNIQUE (${createIndex(key)})`);
            } else if (shouldUpdate) {
                create.push(`CONSTRAINT ${escapeId(name)} UNIQUE (${createIndex(key)})`);
                update.push(`DROP CONSTRAINT ${escapeId(oldIndex.constraint_name)}`);
            }
        }

        if (!columns.length) {
            this.logger.info("auto creating table %c", name);
            return this.query<any>(`CREATE TABLE ${escapeId(name)} (${create.join(", ")}, _pg_mtime BIGINT)`);
        }

        const operations = [...create.map((def) => "ADD " + def), ...update];
        if (operations.length) {
            // https://www.postgresql.org/docs/current/sql-altertable.html
            this.logger.info("auto updating table %c", name);
            if (rename.length) {
                await Promise.all(rename.map((op) => this.query(`ALTER TABLE ${escapeId(name)} ${op}`)));
            }
            await this.query(`ALTER TABLE ${escapeId(name)} ${operations.join(", ")}`);
        }

        const dropKeys: string[] = [];
        await this.migrate(name, {
            error: this.logger.warn,
            before: (keys) => keys.every((key) => columns.some((info) => info.column_name === key)),
            after: (keys) => dropKeys.push(...keys),
            finalize: async () => {
                if (!dropKeys.length) return;
                this.logger.info("auto migrating table %c", name);
                await this.query(`ALTER TABLE ${escapeId(name)} ${dropKeys.map((key) => `DROP ${escapeId(key)}`).join(", ")}`);
            },
        });
    }

    async drop(table: string) {
        await this.query(`DROP TABLE IF EXISTS ${escapeId(table)} CASCADE`);
    }

    async dropAll() {
        const tables: TableInfo[] = await this.queue(`SELECT * FROM information_schema.tables WHERE table_schema = 'public'`);
        if (!tables.length) return;
        await this.query(`DROP TABLE IF EXISTS ${tables.map((t) => escapeId(t.table_name)).join(",")} CASCADE`);
    }

    async stats(): Promise<Partial<Driver.Stats>> {
        const names = Object.keys(this.database.tables);
        const tables = (await this.queue<TableInfo[]>(`SELECT * FROM information_schema.tables WHERE table_schema = 'public'`))
            .map((t) => t.table_name)
            .filter((name) => names.includes(name));
        const tableStats = await this.queue(
            tables
                .map(
                    (name) =>
                        `SELECT '${name}' AS name, pg_total_relation_size('${escapeId(name)}') AS size, COUNT(*) AS count FROM ${escapeId(name)}`
                )
                .join(" UNION ")
        ).then((s) => s.map((t) => [t.name, { size: +t.size, count: +t.count }]));

        return {
            size: tableStats.reduce((p, c) => (p += c[1].size), 0),
            tables: Object.fromEntries(tableStats),
        };
    }

    async get(sel: Selection.Immutable) {
        const builder = new PGliteBuilder(this, sel.tables);
        const query = builder.get(sel);
        if (!query) return [];
        return this.queue(query).then((data) => {
            return data.map((row) => builder.load(row, sel.model));
        });
    }

    async eval(sel: Selection.Immutable, expr: Eval.Expr<any, boolean>) {
        const builder = new PGliteBuilder(this, sel.tables);
        const inner = builder.get(sel.table as Selection, true, true);
        const output = builder.parseEval(expr, false);
        const ref = isBracketed(inner) ? sel.ref : "";
        const [data] = await this.queue(`SELECT ${output} AS value FROM ${inner} ${ref}`);
        return builder.load(data?.value, expr);
    }

    async set(sel: Selection.Mutable, data: {}) {
        const { model, query, table, tables, ref } = sel;
        const builder = new PGliteBuilder(this, tables);
        const filter = builder.parseQuery(query);
        const fields = model.avaiableFields();
        if (filter === "0") return {};
        const updateFields = [
            ...new Set(
                Object.keys(data).map((key) => {
                    return Object.keys(fields).find((field) => field === key || key.startsWith(field + "."))!;
                })
            ),
        ];

        const update = updateFields
            .map((field) => {
                const escaped = builder.escapeId(field);
                return `${escaped} = ${builder.toUpdateExpr(data, field, fields[field], false)}`;
            })
            .join(", ");
        const result = await this.query(`UPDATE ${builder.escapeId(table)} ${ref} SET ${update} WHERE ${filter} RETURNING *`);
        return { matched: result.length };
    }

    async remove(sel: Selection.Mutable) {
        const builder = new PGliteBuilder(this, sel.tables);
        const query = builder.parseQuery(sel.query);
        if (query === "FALSE") return {};
        const result = await this.query(`DELETE FROM ${builder.escapeId(sel.table)} WHERE ${query} RETURNING *`);
        const count = result.length;
        return { matched: count, removed: count };
    }

    async create(sel: Selection.Mutable, data: any) {
        const { table, model } = sel;
        const builder = new PGliteBuilder(this, sel.tables);
        const formatted = builder.dump(data, model);
        const keys = Object.keys(formatted);
        const [row] = await this.query(
            [
                `INSERT INTO ${builder.escapeId(table)} (${keys.map(builder.escapeId).join(", ")})`,
                `VALUES (${keys.map((key) => builder.escapePrimitive(formatted[key], model.getType(key))).join(", ")})`,
                `RETURNING *`,
            ].join(" ")
        );
        return builder.load(row, model);
    }

    async upsert(sel: Selection.Mutable, data: any[], keys: string[]) {
        if (!data.length) return {};
        const { model, table, tables, ref } = sel;
        const builder = new PGliteBuilder(this, tables);
        builder.upsert(table);

        this._counter = (this._counter + 1) % 256;
        const mtime = Date.now() * 256 + this._counter;
        const merged = {};
        const insertion = data.map((item) => {
            Object.assign(merged, item);
            return model.format(executeUpdate(model.create(), item, ref));
        });
        const initFields = Object.keys(model.avaiableFields());
        const dataFields = [
            ...new Set(
                Object.keys(merged).map((key) => {
                    return initFields.find((field) => field === key || key.startsWith(field + "."))!;
                })
            ),
        ];
        let updateFields = difference(dataFields, keys);
        if (!updateFields.length) updateFields = dataFields.length ? [dataFields[0]] : [];

        const createFilter = (item: any) => builder.parseQuery(pick(item, keys));
        const createMultiFilter = (items: any[]) => {
            if (items.length === 1) {
                return createFilter(items[0]);
            } else if (keys.length === 1) {
                const key = keys[0];
                return builder.parseQuery({ [key]: items.map((item) => item[key]) });
            } else {
                return items.map(createFilter).join(" OR ");
            }
        };
        const formatValues = (table: string, data: object, keys: readonly string[]) => {
            return keys
                .map((key) => {
                    const field = this.database.tables[table]?.fields[key];
                    if (model.autoInc && model.primary === key && !data[key]) return "default";
                    return builder.escape(data[key], field);
                })
                .join(", ");
        };

        const update = updateFields
            .map((field) => {
                const escaped = builder.escapeId(field);
                const branches: Dict<any[]> = {};
                data.forEach((item) => {
                    (branches[builder.toUpdateExpr(item, field, model.fields[field], true)] ??= []).push(item);
                });

                const entries = Object.entries(branches)
                    .map(([expr, items]) => [createMultiFilter(items), expr])
                    .sort(([a], [b]) => a.length - b.length)
                    .reverse();

                let value = "CASE ";
                for (let index = 0; index < entries.length; index++) {
                    value += `WHEN (${entries[index][0]}) THEN (${entries[index][1]}) `;
                }
                value += "END";
                return `${escaped} = ${value}`;
            })
            .join(", ");

        const result = await this.query(
            [
                `INSERT INTO ${builder.escapeId(table)} (${initFields.map(builder.escapeId).join(", ")})`,
                `VALUES (${insertion.map((item) => formatValues(table, item, initFields)).join("), (")})`,
                update ? `ON CONFLICT (${keys.map(builder.escapeId).join(", ")})` : "",
                update ? `DO UPDATE SET ${update}, _pg_mtime = ${mtime}` : "",
                `RETURNING _pg_mtime as rtime`,
            ].join(" ")
        );
        return {
            inserted: result.filter(({ rtime }) => +rtime !== mtime).length,
            matched: result.filter(({ rtime }) => +rtime === mtime).length,
        };
    }

    async withTransaction(callback: (session: any) => Promise<void>) {
        return await this.pglite.transaction(async (tx) => {
            const oldSession = this.session;
            this.session = tx;
            try {
                await callback(tx);
            } finally {
                this.session = oldSession;
            }
        });
    }

    async getIndexes(table: string) {
        const indexes = await this.queue<IndexInfo[]>(
            `SELECT * FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${this.sql.escape(table)}`
        );
        const result: Driver.Index[] = [];
        for (const { indexname: name, indexdef: sql } of indexes) {
            result.push({
                name,
                unique: sql.toUpperCase().startsWith("CREATE UNIQUE"),
                keys: this._parseIndexDef(sql),
            });
        }
        return Object.values(result);
    }

    async createIndex(table: string, index: Driver.Index) {
        const keyFields = Object.entries(index.keys)
            .map(([key, direction]) => `${escapeId(key)} ${direction ?? "asc"}`)
            .join(", ");
        await this.query(
            `CREATE ${index.unique ? "UNIQUE" : ""} INDEX ${index.name ? `IF NOT EXISTS ${escapeId(index.name)}` : ""} ON ${escapeId(table)} (${keyFields})`
        );
    }

    async dropIndex(table: string, name: string) {
        await this.query(`DROP INDEX ${escapeId(name)}`);
    }

    _parseIndexDef(def: string) {
        try {
            const keys = {},
                matches = def.match(/\((.*)\)/)!;
            matches[1].split(",").forEach((key) => {
                const [name, direction] = key.trim().split(" ");
                keys[name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name] =
                    direction?.toLowerCase() === "desc" ? "desc" : "asc";
            });
            return keys;
        } catch {
            return {};
        }
    }

    private getTypeDef(field: Field & { autoInc?: boolean }) {
        let { deftype: type, length, precision, scale, autoInc } = field;
        switch (type) {
            case "primary":
            case "unsigned":
            case "integer":
                length ||= 4;
                if (precision) return `numeric(${precision}, ${scale ?? 0})`;
                else if (length <= 2) return autoInc ? "smallserial" : "smallint";
                else if (length <= 4) return autoInc ? "serial" : "integer";
                else {
                    if (length > 8) this.logger.warn(`type ${type}(${length}) exceeds the max supported length`);
                    return autoInc ? "bigserial" : "bigint";
                }
            case "bigint":
                return "bigint";
            case "decimal":
                return `numeric(${precision ?? 10}, ${scale ?? 0})`;
            case "float":
                return "real";
            case "double":
                return "double precision";
            case "char":
                return `varchar(${length || 64}) `;
            case "string":
                return `varchar(${length || 255})`;
            case "text":
                return `text`;
            case "boolean":
                return "boolean";
            case "list":
                return "text[]";
            case "json":
                return "jsonb";
            case "date":
                return "timestamp with time zone";
            case "time":
                return "time with time zone";
            case "timestamp":
                return "timestamp with time zone";
            case "binary":
                return "bytea";
            //@ts-ignore
            case "vector":
                return field.length ? `vector(${field.length})` : "vector";
            default:
                throw new Error(`unsupported type: ${type}`);
        }
    }

    private isDefUpdated(field: Field & { autoInc?: boolean }, column: ColumnInfo, def: string) {
        const typename = def.split(/[ (]/)[0];
        if (field.autoInc) return false;
        if (["unsigned", "integer"].includes(field.deftype!)) {
            if (column.data_type !== typename) return true;
        } else if (typename === "text[]") {
            if (column.data_type !== "ARRAY") return true;
        } else if (Field.date.includes(field.deftype!)) {
            if (column.data_type !== def) return true;
        } else if (typename === "varchar") {
            if (column.data_type !== "character varying") return true;
        } else if (typename !== column.data_type) return true;
        switch (field.deftype) {
            case "integer":
            case "unsigned":
            case "char":
            case "string":
                return !!field.length && !!column.character_maximum_length && column.character_maximum_length !== field.length;
            case "decimal":
                return column.numeric_precision !== field.precision || column.numeric_scale !== field.scale;
            case "text":
            case "list":
            case "json":
                return false;
            default:
                return false;
        }
    }
}

export namespace PGliteDriver {
    export interface Config extends PGliteOptions {
        dataDir?: string;
    }

    export const Config: z<Config> = z
        .object({
            dataDir: z.string().default("memory://"),
        })
        .i18n({
            "en-US": enUS,
            "zh-CN": zhCN,
        });
}

export default PGliteDriver;
