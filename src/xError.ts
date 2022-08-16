import { XLoggerType } from "./xLogger";

export function instanceOfXError(object:any): object is XError {
    return "code" in object && "uuid" in object;
}

export interface XErrorLogging {
    logger : XLoggerType;
    obj? : Object;
    message: string;
}

export class XError extends Error  {    
    public code:string;    
    public uuid:string;   
    private logging ?:XErrorLogging;    

    constructor( code:string, message:string, uuid?:string, logging?:XErrorLogging){
        super(message);             
        this.code = code;   
        this.uuid = uuid ?? ""; 
        this.logging = logging;        
    }

    Log() {
        if( this.logging ){            
            this.logging.logger.error(
                this.logging.obj,
                this.logging.message                
            );            
        }
    }
}