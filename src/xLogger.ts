
import chalk from 'chalk';
import * as bunyan from 'bunyan';
import fs from "fs";
import { XUtil } from './xUtil';
const createCWStream = require('bunyan-cloudwatch');


export interface ICloudWatchLogger {
    group_name: string;
    stream_name: string;
    region:string;    
}

export interface ILoggerConfig {
    name: string;
    level: string;
    source:boolean;
    console: boolean;
    file_path: string;
    file_name: string;
    cloudwatch?: ICloudWatchLogger;
}

export type XLoggerType = ReturnType<typeof bunyan.createLogger>;

export class XLogger {
    private static _logger: XLoggerType;

    public static  Init(config:ILoggerConfig){

        let log_path = config.file_path;
        if (log_path.charAt(log_path.length - 1) != '/' && log_path.charAt(log_path.length - 1) != '\\') {
            log_path += '/';
        }
        const port = process.argv[2];          
        try {
            fs.mkdirSync(log_path);            
        } catch (error:any) {
            if( error.code !== 'EEXIST'){
                console.log(error);
                throw error;
            }            
        }               
        this._logger = bunyan.createLogger({
            name: config.name,
            level: <bunyan.LogLevel>config.level,
            src: config.source,
            streams: [
                {
                    path: `${log_path}${config.file_name}_${port}.log`
                },

            ]
        });   
        if( config.console){
            let a:NodeJS.WritableStream;
            this._logger.addStream({
                type: 'raw',
                stream: { 
                    write: function(rec:any){
                        let dateStr = (<Date>rec.time).toISOString();
                        let funcName = "";
                        if( rec.class )
                            funcName = rec.class;
                        if( rec.func ){
                            if( rec.class ){
                                funcName += "::";
                            }
                            funcName += rec.func;
                        }                        
                        if (rec.level <= bunyan.INFO) {                        
                            console.log(
                                `[${chalk.cyan("INFO")}][${chalk.green(dateStr)}]${rec.ip?`[${chalk.magenta(rec.ip)}]`:""} ${funcName!=""?`[${chalk.yellow(funcName)}]`:""} ${chalk.white(rec.msg)}`                                
                            );

                        } else if (rec.level <= bunyan.WARN) {
                            console.log(
                                `[${chalk.yellow("WARN")}][${chalk.green(dateStr)}]${rec.ip?`[${chalk.magenta(rec.ip)}]`:""} ${funcName!=""?`[${chalk.yellow(funcName)}]`:""} ${chalk.yellow(rec.msg)}`
                            );                            
                            
                        } else {
                            console.log(
                                `[${chalk.red("ERROR")}][${chalk.green(dateStr)}]${rec.ip?`[${chalk.magenta(rec.ip)}]`:""} ${funcName!=""?`[${chalk.yellow(funcName)}]`:""} ${chalk.red.bold(rec.msg)} ${rec.src? `(${chalk.gray(`${rec.src.func} ${rec.src.file}:${rec.src.line}`)})`:""}`
                            );                   
                            if( rec.err){
                                console.log(
                                    chalk.magenta.bold(rec.err.stack)
                                );
                            }
                        }                        
                    }
                }                
            });
        }              
        return this._logger;         
    }    
    public static attachCloudwatchLog(config:ILoggerConfig) {
        if( config.cloudwatch ){
            let groupName = config.cloudwatch.group_name;
            if( !groupName || groupName ===""){
                groupName = config.name;
            }
            let streamName = config.cloudwatch.stream_name;
            if( !streamName || streamName === ""){
                streamName = XUtil.GetHostname();
            }
            this._logger.addStream({
                type:'raw',
                stream: createCWStream({
                    logGroupName: groupName,
                    logStreamName: streamName,
                    cloudWatchLogsOptions:{
                        region: config.cloudwatch.region
                    }
                })
            });
        }
    }
    public static Logger() : XLoggerType {
        return this._logger;
    }
}

//export = XLogger;