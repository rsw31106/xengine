import ip from 'ip';
import randomstring from 'randomstring';
import requestIp from 'request-ip';
import { Address6 } from 'ip-address';
import http from 'http';

export class XUtil {
    public static GetHostname(): string{
        let port = process.argv[2];
        return `${ip.address()}${port?`_${port}`:''}`;
    }
    public static async Sleep( ms:number){
        return new Promise( resolve=>{
            setTimeout(resolve,ms);
        });
    }
    public static GetUnixTime() : number{        
        return Math.floor( Date.now() / 1000 );
    }    
    public static GetRandomString(n:number):string{
        return randomstring.generate(n);         
    }
    public static GetRandomInt():number{
        return Math.floor(Number.MAX_SAFE_INTEGER*Math.random());
    }
    // min <= number <= max
    public static GetRandomIntInclude(min:number,max:number):number{
        return Math.floor(Math.random() * (max-min+1)) + min;
    }
    // min <= number < max
    public static GetRandomIntExclude(min:number,max:number):number{
        return Math.floor(Math.random() * (max-min)) + min;
    }

    // replace with 'express-async-handler'
    // public static AsyncUtil(fn:Function) : Function{
    //     return  function asyncUtilWrap(...args:any[]) {
    //         const fnReturn = fn(...args);
    //         const next = args[args.length - 1];
    //         return Promise.resolve(fnReturn).catch(next);
    //     }; 
    // }    
    public static TwoDigits(d:number):string {
        if(0 <= d && d < 10) return "0" + d.toString();
        if(-10 < d && d < 0) return "-0" + (-1*d).toString();
        return d.toString();
    }
    public static GetIP(req:http.IncomingMessage):string {
        try {
            let ipAddr:string = requestIp.getClientIp(req)!;
            let addr = new Address6(ipAddr);
            let ip = addr.address4?.address!;
            return ip;
        }
        catch(err){}
        return req.socket.remoteAddress!;
    }
    // public static GetIP(ip:string):string{
    //     requestIp.getClientIp(ip);
    // }
}



