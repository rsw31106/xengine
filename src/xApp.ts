import { ILoggerConfig, XLogger, XLoggerType } from "./xLogger";
import express from "express";
import AWS from "aws-sdk";
//import * as Sentry from "@sentry/node";
//import * as Tracing from "@sentry/tracing";
import * as http from "http";
import * as https from "https";

export interface IAppConfig {
    use_https: boolean;
    tls_certs?: {
        cert: string;
        private: string;
        ca: string;
        options?: object;
    };
    aws?: {
        region: string;
        username: string;
    };
    logger: ILoggerConfig;
}

export abstract class XApp {
    protected Config: IAppConfig;
    protected Logger: XLoggerType | null;
    protected App: express.Application | null;

    abstract onBeforeExpressSetup(config: IAppConfig): Promise<boolean>;
    abstract onExpressSetup(config: IAppConfig, app: express.Application): Promise<boolean>;
    abstract onServerBeforeStartUp(config: IAppConfig, server: http.Server | https.Server): Promise<boolean>;
    abstract onServerAfterStartUp(config: IAppConfig): Promise<boolean>;
    abstract onExpressErrorHandler(err: Error, req: express.Request, res: express.Response): void;
    abstract onDestroy(): Promise<void>;

    constructor(config: IAppConfig) {
        this.Config = config;
        this.Logger = null;
        this.App = null;
        process.on("beforeExit", async (code: number) => {
            await this.onDestroy();
        });
    }
    public Get() {
        return {
            Logger: this.Logger,
            App: this.App,
        };
    }

    public async StartUp() {
        const config = this.Config;

        this.Logger = XLogger.Init(config.logger);
        this.Logger.info({ class: "XApp", func: "StartUp" }, "Begin to Initialize...");

        // Set AWS SDK
        if (config.aws) {
            try {
                if (config.aws.region !== "") {
                    config.aws.region = "ap-southeast-2"; // default region
                }
                AWS.config.update({
                    region: config.aws.region,
                });
                // Check AWS SDK credential have no problem
                let iam = new AWS.IAM();
                let info = await iam
                    .getUser({
                        UserName: config.aws.username,
                    })
                    .promise();
                this.Logger.info({ class: "XApp", func: "StartUp" }, `AWS SDK Loaded.. UserName:${info.User.UserName} UserID:${info.User.UserId} ARN:${info.User.Arn}`);
                // aws sdk load가 성공한 후에 cloudwatch log를 attach 해준다.
                XLogger.attachCloudwatchLog(config.logger);
            } catch (err) {
                const typedError = err as Error;
                this.Logger.error({ class: "XApp", func: "StartUp" }, `Failed to load AWS SDK.. err:${typedError.message}`);
                config.aws = undefined;
            }
        }

        if (!(await this.onBeforeExpressSetup(config))) {
            this.Logger.error({ class: "XApp", func: "StartUp" }, `Failed 'onBeforeExpressSetup'.. exit..`);
            process.exit(0);
        }

        this.App = express();

        /*
        Sentry.init({
            dsn: "",
            integrations: [
                // enable HTTP calls tracing
                new Sentry.Integrations.Http({ tracing: true }),
                // enable Express.js middleware tracing
                new Tracing.Integrations.Express({ app: this.App }),
            ],

            // Set tracesSampleRate to 1.0 to capture 100%
            // of transactions for performance monitoring.
            // We recommend adjusting this value in production
            tracesSampleRate: 1.0,
        });
        // RequestHandler creates a separate execution context using domains, so that every
        // transaction/span/breadcrumb is attached to its own Hub instance
        this.App.use(Sentry.Handlers.requestHandler());
        // TracingHandler creates a trace for every incoming request
        this.App.use(Sentry.Handlers.tracingHandler());
        */

        if (!(await this.onExpressSetup(config, this.App))) {
            this.Logger.error({ class: "XApp", func: "StartUp" }, `Failed 'onExpressSetup'.. exit..`);
            process.exit(0);
        }

        // The error handler must be before any other error middleware and after all controllers
        //this.App.use(Sentry.Handlers.errorHandler());
        this.App.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.onExpressErrorHandler(err, req, res);
            //this._errorHandler(err, req, res, next);
        });
        await this._setupHTTP(config);
    }

    protected defaultErrorHandler(err: Error, req: express.Request, res: express.Response, next: express.NextFunction) {
        this.Logger!.error({ class: "XApp", func: "_errorHandler" }, err);
        res.sendStatus(500);
    }
    protected createHTTPServer(port:number) {
        let httpServer = http.createServer(<http.RequestListener>this.App);
        httpServer.listen(port, async () => {
            this.Logger!.info({ class: "XApp", func: "createHTTP" }, "HTTP Server listening on port:" + port);            
        });
    }

    private async _setupHTTP(config: IAppConfig) {
        if (process.argv.length < 3) {
            this.Logger!.error({ class: "XApp", func: "_setupHTTP" }, "Running Argument for Port needed.. exit process..");
            process.exit(9); // exit code 9 == Invalid Argument.
        }
        let port = process.argv[2];

        let funcStartup = async () => {
            if (!(await this.onServerAfterStartUp(config))) {
                this.Logger!.error({ class: "XApp", func: "_setupHTTP" }, `Failed 'onServerAfterStartUp'`);
                process.exit(0);
            }
            this.Logger!.info({ class: "XApp", func: "_setupHTTP" }, "Server Startup Successfully...");
        };
        if (config.use_https) {
            if (!config.tls_certs) {
                this.Logger!.error({ class: "XApp", func: "_setupHTTP" }, `HTTPS need tls..`);
                process.exit(-1);
            }
            const { constants } = require("crypto");
            const fs = require("fs");
            let key: string | undefined;
            let cert: string | undefined;
            let ca: string | undefined;
            if (config.tls_certs.private != "") {
                key = fs.readFileSync(config.tls_certs.private, "utf8");
            }
            if (config.tls_certs.cert != "") {
                cert = fs.readFileSync(config.tls_certs.cert, "utf8");
            }
            if (config.tls_certs.ca != "") {
                ca = fs.readFileSync(config.tls_certs.ca, "utf8");
            }
            let credentials: https.ServerOptions = {
                key, //: fs.readFileSync(config.tls_certs.private, "utf8"),
                cert, //: fs.readFileSync(config.tls_certs.cert, "utf8"),
                ca, //: fs.readFileSync(config.tls_certs.ca, "utf8"),
                secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1,
            };
            if (config.tls_certs.options) {
                credentials = { ...credentials, ...config.tls_certs.options };
            }
            let httpsServer = https.createServer(credentials, <http.RequestListener>this.App);
            if (!(await this.onServerBeforeStartUp(config, httpsServer))) {
                this.Logger!.error({ class: "XApp", func: "StartUp" }, `Failed 'onServerBeforeStartUp'.. exit..`);
                process.exit(-1);
            }
            httpsServer.listen(port, async () => {
                this.Logger!.info({ class: "XApp", func: "_setupHTTP" }, "HTTPS Server listening on port " + port);
                await funcStartup();
            });
        } else {
            let httpServer = http.createServer(<http.RequestListener>this.App);
            if (!(await this.onServerBeforeStartUp(config, httpServer))) {
                this.Logger!.error({ class: "XApp", func: "StartUp" }, `Failed 'onServerBeforeStartUp'.. exit..`);
                process.exit(-1);
            }
            httpServer.listen(port, async () => {
                this.Logger!.info({ class: "XApp", func: "_setupHTTP" }, "HTTP Server listening on port " + port);
                await funcStartup();
            });
        }
    }
}
