import { Context, Service } from "koishi";
declare module "koishi" {
  interface Context {
    extension: Extension
  }
}

class Extension extends Service {
  constructor(ctx: Context) {
    super(ctx, "extension");
  }

  apply(extName: string, ...args: any) {}
}

