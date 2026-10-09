declare module "mustache" {
    export interface MustacheRenderOptions {
        tags?: [string, string];
        escape?: (text: string) => string;
    }
    export const Mustache: {
        render(template: string, view: any, partials?: Record<string, string>, options?: MustacheRenderOptions): string;
        parse(template: string, tags?: [string, string]): any[];
        clearCache(): void;
        escape(text: string): string;
        [key: string]: any;
    };
    export default Mustache;
}
