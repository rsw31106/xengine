import { bool } from "aws-sdk/clients/signer";
import { createClient } from "redis";
import { XLogger,XLoggerType } from "./xLogger";
import { XUtil } from "./xUtil";

export interface IRedisConfig {
    host: string;
    port: number;
    password: string;
    connection_timeout_ms: number;
    keep_alive_ms: number;
    readonly: boolean;
    channel_name: string;
}
export interface IRedisMessageReceiver {
    onRedisMessage(message:string): void;
}

export type RedisClientType = ReturnType<typeof createClient>;
type reconnectStrategyFunc = (retries:number)=>number|Error;

export class XRedis {
    protected config : IRedisConfig;
    protected logger: XLoggerType;
    protected redis: RedisClientType|null;
    protected errorOccurred : bool;  
    protected major_version: number = 0;  
    protected minor_version: number = 0;

    constructor( config:IRedisConfig,  logger: XLoggerType ){
        this.config = config;
        this.logger = logger.child({
            class: this.constructor.name
        });        
        this.errorOccurred = false;
        this.redis = null;        
    }   
    protected async  _checkRedis() {
        let redis = this._createRedis( (retries:number)=>{
            throw new Error(`Failed to connect redis.. config:${JSON.stringify(this.config)}`);
        });
        redis.on("error", async (err) => {            
            //this.logger.error({ err, type: "redis got error", func: "redis.error" }, `Redis got error :${err.message}`);            
        });   
        await redis.connect();                
        // Check Redis Version
        let version = await redis.info("server")!;
        version = version
            .split("\r\n")
            .find((v) => v.includes("redis_version"))!
            .split(":")[1];
        let t = version.split(".");
        this.major_version = parseInt(t[0]);
        this.minor_version = parseInt(t[1]);

        this.logger.info({ func: "_checkRedis" }, `--> Redis MajorVersion:${this.major_version} MinorVersion:${this.minor_version}`);
        if (this.major_version < 5) {
            throw new Error("Redis version must be greater than 5!!");
        }
        await redis.disconnect();
    }
    get() : RedisClientType {
        return this.redis!;
    }

    async Init(tryConnect:boolean=true) {
        //=============================================================
        // Initialize Redis
        //=============================================================
        this.logger.info({ func: "Init" }, "Begin connect to Redis...");
        // check redis server 
        await this._checkRedis();       
        this.redis = this._createRedis( (retries:number)=>{            
            this.logger.info({ type: "redis reconnect", func: "redis" }, `Redis try to reconnect.. retries:${retries}`);
            // if (retries > 10) {
            //      return new Error("failed to connect to redis.. retries over 10");
            // }
            return Math.min(retries * 500, 1000*3);
        });
        this._setupRedisCallback();
        if( tryConnect ){
            await this.redis.connect();
        }
        this.logger.info({ func: "Init" }, "--> Done");               
    }

    private _createRedis( reconnectStrategy:reconnectStrategyFunc): RedisClientType {
        let redis = createClient({
            socket: {
                host: this.config.host,
                port: this.config.port,
                connectTimeout: this.config.connection_timeout_ms,
                keepAlive: this.config.keep_alive_ms,            
                reconnectStrategy: reconnectStrategy,                
            },
            disableOfflineQueue: true,
            password: this.config.password,
            name: `${XUtil.GetHostname()}_${this.constructor.name}`,
            readonly: this.config.readonly,
        });     
        return redis;
    }

    protected _setupRedisCallback() {
        if( this.redis == null ){
            return;
        }
        this.redis.on("error", async (err) => {
            this.errorOccurred = true;
            this.logger.error({ err, type: "redis got error", func: "redis.error" }, `Redis got error :${err.message}`);            
        });       
        this.redis.on("ready", async()=>{
            if( this.errorOccurred ){
                this.logger.info({func:"redis.ready", type:"redis reconnected"},"Redis reconnected successfully...");
                try {
                    await this._onReconnected();
                }catch(err){
                    let typedError = err as Error;
                    this.logger.error({err,func:"redis.ready._onReconnected", type:"_onReconnected got error"}, `_onReconnected got error:${typedError.message}`);
                }
            }
            this.errorOccurred = false;
        });
    }
    protected _onReconnected() {}
    
}


export class SubscribeRedis extends XRedis {

    private messageReceiver : IRedisMessageReceiver|null;

    constructor(config:IRedisConfig,  logger: XLoggerType){
        super(config,logger);
        this.messageReceiver = null;
    }
    setMessageReceiver( receiver : IRedisMessageReceiver){
        this.messageReceiver = receiver;
    }
    async Init(){
        await super.Init(false);                
        await this.redis!.connect();
    }
    async _onReconnected() {
        // 재연결되면 자동으로 subscribe 됨        
    }

    async Subscribe(){
        try {
            if( this.redis == null ){
                throw new Error('redis instance is null');
            }
            await this.redis.subscribe(this.config.channel_name, async (message) => {
                try {
                    if( this.messageReceiver != null ){
                        await this.messageReceiver.onRedisMessage(message);                    
                    }                                        
                } catch (err) {
                    const typedError = err as Error;
                    this.logger.error({err,func:"_onRedisMessage",type:"redis message handler error"}, `Process redis message got error.. message:${message} err:${typedError.message}`);
                }
            });
            this.logger.info({func:"Subscribe"}, `Subscribe channel:${this.config.channel_name} done..`);
        }catch(err){
            const typedError = err as Error;
            this.logger.error({err,func:"Subscribe", type:"redis subscribe failed"}, `Failed to subscribe channel:${this.config.channel_name}.. err:${typedError.message}`);
        }        
    }   
}


