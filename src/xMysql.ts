import { QueryError, Pool, createPool, PoolConnection, RowDataPacket, FieldPacket } from "mysql2/promise";
import { XLoggerType } from "./xLogger";
import { XError } from "./xError";

export interface IMySQLConfig {
    master: IMySQLDetailConfig;
    slave?: IMySQLDetailConfig;
}

export interface IMySQLDetailConfig {
    ip: string;
    port: number;
    id: string;
    password: string;
    database: string;
    pool_limit?: number;
    connection_timeout_ms?: number;    
}

export interface XMySQLError extends QueryError {
    sql: string;
    sqlMessage: string;
}

/** 풀 점유 상태. mysql2 내부 필드(_allConnections/_freeConnections/_connectionQueue)를 읽으므로 없으면 0으로 둔다. */
export interface XMySQLPoolStats { active: number; idle: number; waiting: number; max: number }
/** 커넥션 획득 대기 시간(ms) 리스너. 예외는 삼킨다 — 계측이 쿼리를 막지 않는다. */
export type XMySQLAcquireListener = (waitMs: number, readOnly: boolean) => void;

function instanceOfMySqlError(object: any): object is XMySQLError {
    return "code" in object && "errno" in object && "sql" in object;
}

export class XMySQL {
    private name: string;
    private config: IMySQLConfig;
    private logger: XLoggerType;
    private master: Pool;
    private slave: Pool | null;
    private acquireListener: XMySQLAcquireListener | null = null;

    constructor(name: string, config: IMySQLConfig, logger: XLoggerType) {
        this.name = name;
        this.config = config;
        this.logger = logger.child({
            class: this.constructor.name,
            dbname: name,
        });
        let master_config = config.master;
        this.master = createPool({
            host: master_config.ip,
            port: master_config.port,
            user: master_config.id,
            password: master_config.password,
            database: master_config.database,            
            supportBigNumbers: true,
            bigNumberStrings: true,

            connectionLimit: master_config.pool_limit ? master_config.pool_limit : 1,
            connectTimeout: master_config.connection_timeout_ms ? master_config.connection_timeout_ms : 1000 * 8,

            enableKeepAlive: true,
            keepAliveInitialDelay: 1000 * 5,
            maxIdle: 0,
            idleTimeout: 600000,
            rowsAsArray: false,
        });
        this.slave = null;
        let slave_config = config.slave;
        if (slave_config) {
            this.slave = createPool({
                host: slave_config.ip,
                port: slave_config.port,
                user: slave_config.id,
                password: slave_config.password,
                database: slave_config.database,                
                supportBigNumbers: true,
                bigNumberStrings: true,

                connectionLimit: slave_config.pool_limit ? slave_config.pool_limit : 1,
                connectTimeout: slave_config.connection_timeout_ms ? slave_config.connection_timeout_ms : 1000 * 8,

                enableKeepAlive: true,
                keepAliveInitialDelay: 1000 * 5,
                maxIdle: 0,
                idleTimeout: 600000,
                rowsAsArray: false
            });
        }
    }

    async Init() {
        this.logger.info(`[${this.name}] Begin Initialize....`);
        // DB가 연결되었는지 체크한다.
        //this.master = await this.master;
        let conn = await this.master.getConnection();
        this.logger.info(`--> ${this.name} Master Checked....`);
        conn.release();
        if (this.slave) {
            //this.slave = await this.slave;
            conn = await this.slave.getConnection();
            this.logger.info(`--> ${this.name} Slave Checked....`);
            conn.release();
        }
        this.logger.info(`[${this.name}] Done..`);
    }
    async Terminate() {
        await this.master.end();
        if( this.slave ){
            await this.slave.end();
        }
    }

    async _getReadConn() {
        let conn = null;
        if (this.slave) conn = await this.slave.getConnection();
        else conn = await this.master.getConnection();
        return conn;
    }

    /** 계측 훅 등록(null이면 해제). 호출 비용은 Date.now() 2회뿐이다. */
    setAcquireListener(fn: XMySQLAcquireListener | null) {
        this.acquireListener = fn;
    }

    /** master 풀의 현재 점유. active = 전체 − idle, waiting = 대기 큐 길이, max = connectionLimit. */
    poolStats(): XMySQLPoolStats {
        const p: any = (this.master as any)?.pool ?? this.master;
        const all = Number(p?._allConnections?.length ?? 0), free = Number(p?._freeConnections?.length ?? 0);
        return {
            active: Math.max(0, all - free),
            idle: free,
            waiting: Number(p?._connectionQueue?.length ?? 0),
            max: Number(p?.config?.connectionLimit ?? this.config.master.pool_limit ?? 1),
        };
    }

    /** 커넥션 획득 + 대기 시간 계측. query/transaction의 유일한 획득 경로. */
    private async _acquire(readOnly: boolean): Promise<PoolConnection> {
        const t0 = Date.now();
        const con = readOnly ? await this._getReadConn() : await this.master.getConnection();
        if (this.acquireListener) {
            try { this.acquireListener(Date.now() - t0, readOnly); } catch { /* 계측 실패 무시 */ }
        }
        return con;
    }

    async _resolveFailOver(is_transaction: boolean, fn: Function, ...args: any[]) {
        // limit만큼 돈다.
        let beginTime = new Date().getTime();
        this.logger.info({ func: "_resolveFailOver" }, `[${this.name}] Begin resolve failover...`);
        try {
            let call_fn = async function (conn: PoolConnection) {
                return await fn(conn, ...args).catch(async (error: Error) => {
                    if (is_transaction) {
                        // rollback을 진행한다.
                        await conn.rollback();
                    }
                    conn.release();
                    throw error;
                });
            };
            let cnt = this.config.master.pool_limit ? this.config.master.pool_limit : 1;
            for (let i = 0; i < cnt; ++i) {
                let con = await this.master.getConnection();
                let [res, fields]: [RowDataPacket[], FieldPacket[]] = await con.query("SHOW GLOBAL VARIABLES LIKE 'innodb_read_only'");
                if (!res || res.length != 1) {
                    con.destroy();
                    this.logger.error(
                        { func: "_resolveFailOver", type: "SHOW GLOBAL VARIABLES LIKE 'innodb_read_only' result is invalid" },
                        `[${this.name}] SHOW GLOBAL VARIABLES LIKE 'innodb_read_only' result is invalid.. length:${res ? res.length : 0}`
                    );
                    continue;
                }
                // 접속을 해제해준다.
                let value = res[0][fields[1].name];
                if (value == "ON") {
                    con.destroy();
                    this.logger.info({ func: "_resolveFailOver" }, `[${this.name}][${i}] Destroy read-only connection..`);
                    continue;
                }
                if (is_transaction) {
                    await con.beginTransaction();
                }
                let result = await call_fn(con);
                if (is_transaction) {
                    await con.commit();
                }
                con.release();
                this.logger.info({ func: "_resolveFailOver" }, `[${this.name}] Resolved --> ${new Date().getTime() - beginTime}ms`);
                return result;
            }
        } catch (err: any) {
            //this.logger.info({err,func:"_resolveFailOver"}, `[${this.name}] error occurred..`);
            throw err;
        }
        throw new Error(`[${this.name}] No more connections...`);
    }

    async query(readOnly: boolean, uuid: string, fn: Function, ...args: any[]) {
        // DB 커넥션을 한다.
        const con = await this._acquire(readOnly);

        // 로직에 con과 args(넘겨받은 paramter)를 넘겨준다.
        const result = await fn(con, ...args).catch(async (error: Error) => {            
            // 에러시 con을 닫아준다.
            con.release();
            try {
                if (instanceOfMySqlError(error)) {
                    if (error.code == "ER_OPTION_PREVENTS_STATEMENT" || error.errno == 1290 || error.code == "ER_CANT_LOCK" || error.errno == 1015
                        || error.code == "PROTOCOL_CONNECTION_LOST" || error.code == "ECONNRESET") {
                        try {
                            this.logger.info({ func: "query", uuid }, `[${this.name}] got error but try to resolve failover..`);
                            return await this._resolveFailOver(false, fn, ...args);
                        } catch (err) {
                            throw err;
                        }
                    }
                }
                throw error;
            } catch (err) {
                let message = "";
                if (instanceOfMySqlError(err)) {
                    message = `[${this.name}] query failed. code:${err.code} no:${err.errno} state:${err.sqlState} sql:${err.sql} stack:${err.stack}`;
                    this.logger.error({ err, func: "query", type: "mysql error", uuid }, message);
                } else if (err instanceof XError) {
                    // XError인 경우 그대로 throw한다.
                    throw err;
                } else {
                    const typedError = err as Error;
                    this.logger.error({ err, func: "query", type: "mysql error", uuid }, typedError.message);
                    message = typedError.message;
                }
                // 제일 마지막에는 XError를 throw해서 응답처리를 한다.
                throw new XError("DB_FAILED", message, uuid);
            }
        });
        // con을 닫아준다.
        con.release();
        return result;
    }
    async transaction(readOnly: boolean, uuid: string, fn: Function, ...args: any[]) {
        // DB 커넥션을 한다.
        const con = await this._acquire(readOnly);
        // 트렌젝션 시작
        await con.beginTransaction();
        // 비지니스 로직에 con을 넘겨준다.
        const result = await fn(con, ...args).catch(async (error: Error) => {
            // rollback을 진행한다.
            await con.rollback();
            // 에러시 con을 닫아준다.
            con.release();

            try {
                if (instanceOfMySqlError(error)) {
                    if (error.code == "ER_OPTION_PREVENTS_STATEMENT" || error.errno == 1290 || error.code == "ER_CANT_LOCK" || error.errno == 1015 || 
                        error.code == "PROTOCOL_CONNECTION_LOST" || error.code == "ECONNRESET") {
                        try {
                            this.logger.info({ func: "transaction", uuid }, `[${this.name}] got error but try to resolve failover..`);
                            return await this._resolveFailOver(true, fn, ...args);
                        } catch (err) {
                            throw err;
                        }
                    }
                }
                throw error;
            } catch (err) {
                let message = "";
                if (instanceOfMySqlError(err)) {
                    message = `[${this.name}] query failed. code:${err.code} no:${err.errno} state:${err.sqlState} sql:${err.sql} msg:${err.sqlMessage}`;
                    this.logger.error({ err, func: "transaction", type: "mysql error", uuid }, message);
                } else if (err instanceof XError) {
                    // XError인 경우 그대로 throw한다.
                    throw err;
                }
                else {
                    const typedError = err as Error;
                    this.logger.error({ err, func: "transaction", type: "mysql error", uuid }, typedError.message);
                    message = typedError.message;
                }
                // 제일 마지막에는 XError를 throw해서 응답처리를 한다.
                throw new XError("DB_FAILED", message, uuid);
            }
        });
        // commit을 해준다.
        await con.commit();
        // con을 닫아준다.
        con.release();
        return result;
    }
}
