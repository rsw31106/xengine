import ip from 'ip';
import randomstring from 'randomstring';
import requestIp from 'request-ip';
import { Address6 } from 'ip-address';
import http from 'http';
import * as AWS from 'aws-sdk';

export class XUtil {
    public static GetHostname(): string {
        let port = process.argv[2];
        return `${ip.address()}${port ? `_${port}` : ''}`;
    }
    public static async Sleep(ms: number) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
    public static GetUnixTime(): number {
        return Math.floor(Date.now() / 1000);
    }
    public static GetRandomString(n: number): string {
        return randomstring.generate(n);
    }
    public static GetRandomInt(): number {
        return Math.floor(Number.MAX_SAFE_INTEGER * Math.random());
    }
    // min <= number <= max
    public static GetRandomIntInclude(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    // min <= number < max
    public static GetRandomIntExclude(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min)) + min;
    }

    // replace with 'express-async-handler'
    // public static AsyncUtil(fn:Function) : Function{
    //     return  function asyncUtilWrap(...args:any[]) {
    //         const fnReturn = fn(...args);
    //         const next = args[args.length - 1];
    //         return Promise.resolve(fnReturn).catch(next);
    //     }; 
    // }    
    public static TwoDigits(d: number): string {
        if (0 <= d && d < 10) return "0" + d.toString();
        if (-10 < d && d < 0) return "-0" + (-1 * d).toString();
        return d.toString();
    }
    public static GetIP(req: http.IncomingMessage): string {
        let orgIP = req.socket.remoteAddress;
        try {
            let ipAddr: string = requestIp.getClientIp(req)!;
            if (ipAddr != orgIP) {
                return ipAddr;
            }
            let addr = new Address6(ipAddr);
            if (addr.address4) {
                return addr.address4.address;
            }
            try {
                let addrv4 = addr.to4();
                return addrv4.address;
            }
            catch (err) { }
            if (req.socket.remoteAddress) {
                return req.socket.remoteAddress;
            }
            return ipAddr;
        }
        catch (err) { }
        return req.socket.remoteAddress!;
    }
    public static RoundFloat(num: number, places: number) {
        return +(Math.round(Number(num + `e+${places}`)) + "e-" + places);
    }
    public static FloorFloat(num: number, places: number) {
        return +(Math.floor(Number(num + `e+${places}`)) + "e-" + places);
    }
    // public static GetIP(ip:string):string{
    //     requestIp.getClientIp(ip);
    // }

    public static IS_LOCAL_SERVER() {
        return process.env.CONFIG == "local";
    }
    public static IS_TEST_SERVER() {
        return process.env.CONFIG == "test";
    }
    public static IS_LIVE_SERVER() {
        return process.env.CONFIG == "live";
    }
    public static CHECK_UNDEFINED(v: any, comment: string): any {
        if (!v) {
            throw new Error(comment);
        }
        return v;
    }
    public static CHECK_BOOLEAN(v: any, comment: string): boolean {
        if (v == undefined) {
            throw new Error(comment);
        }
        if (typeof v !== "boolean") {
            let _v = this.CHECK_NUMBER(v, comment, true);
            return _v == 0 ? false : true;
        }
        return v;
    };
    public static CHECK_NUMBER(v: string | number, comment: string, mustInteger: boolean = true): number {
        if (v == undefined) {
            throw new Error(comment);
        }
        if (typeof v == "string") {
            let n = parseInt(v);
            if (isNaN(n)) {
                throw new Error(comment);
            }
            v = n;
        }
        if (mustInteger) {
            if (!Number.isInteger(v)) {
                throw new Error(comment + "(Not Integer)");
            }
        }
        return v;
    }
    public static CHECK_MINMAX(v: number, min: number, max: number, comment: string) {
        if (v >= min && v <= max) {
            return;
        }
        throw new Error(comment);
    }
    public static CHECK_STRING_ISEMPTY(v: string, comment: string): string {
        if (v == undefined) {
            throw new Error(comment);
        }
        if (v === "") {
            throw new Error(comment);
        }
        return v;
    }
    public static CHECK_ARRAY(v: any, comment: string) {
        if (v == undefined) {
            throw new Error(comment);
        }
        if (!Array.isArray(v))
            throw new Error(comment);
        return v;
    }
    public static CHECK_STRING_INARRAY(v: string, arr: string[], comment: string): string {
        if (v == undefined) {
            throw new Error(comment);
        }
        if (!arr.includes(v)) {
            throw new Error(comment);
        }
        return v;
    }
    public static CHECK_OBJECT_HASPROPERTY(r: object, nameArr: string[], comment: string, haveAll = true) {
        for (let name of nameArr) {
            const has = r.hasOwnProperty(name);
            if (!haveAll) {
                if (has)
                    return;
            } else {
                if (!has) {
                    throw new Error(comment);
                }
            }
        }
        if (haveAll)
            return;
        throw new Error(comment);
    }

    public static UploadJSONToS3(s3: AWS.S3 | undefined, bucketName: string, pathName: string, objString: string) : Promise<AWS.S3.Types.PutObjectOutput> {
        if (s3 == undefined) {
            s3 = new AWS.S3();
        }        
        const params: AWS.S3.PutObjectRequest = {
            Bucket: bucketName,
            Key: pathName,
            Body: objString,
            ContentType: 'application/json'
        };
        return new Promise((resolve, reject) => {
            s3!.putObject(params, (err,data)=>{
                if( err ){
                    reject(err);
                }
                else{
                    resolve(data);
                }
            });
        });
    }
}

