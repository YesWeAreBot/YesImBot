import fs from "fs";
import { Context } from "koishi";


export abstract class ExtFunction {
  readonly name: string;
  readonly description: string;
  readonly params: { [key: string]: SchemaNode };

  constructor(
    protected readonly ctx: Context,
    protected readonly bot: Bot
  ) {
    // 读取类的静态属性来初始化实例属性
    const funcName = (this.constructor as any)["funcName"];
    const description = (this.constructor as any)["description"];
    const params = (this.constructor as any)["params"];

    // 返回一个函数实例，使得类实例可以调用
    const callable = (keyword: string) => this.apply(keyword);
    Object.defineProperty(callable, "name", { value: funcName });
    Object.defineProperty(callable, "description", { value: description });
    Object.defineProperty(callable, "params", { value: params });
    return callable as any;
  }

  abstract apply(...args: any[]): any;

  get session() {
    return this.bot.session;
  }
}

export function getExtensions(ctx: Context, bot: Bot): ExtFunction[] {
  let extensions: ExtFunction[] = [];

  fs.readdirSync(__dirname)
    .filter((file) => file.startsWith("ext_"))
    .forEach((file) => {
      try {
        const extension = require(`./${file}`);
        for (const key in extension) {
          extensions.push(new extension[key](ctx, bot));
        }
        logger.info(`Loaded extension: ${file}`);
      } catch (e) {
        logger.error(`Failed to load extension: ${file}`, e);
      }
    });
  return extensions;
}
