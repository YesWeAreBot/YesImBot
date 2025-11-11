import antfu from "@antfu/eslint-config";

export default antfu({
    // Type of the project. 'lib' for libraries, the default is 'app'
    // type: "lib",

    // `.eslintignore` is no longer supported in Flat config, use `ignores` instead
    // The `ignores` option in the option (first argument) is specifically treated to always be global ignores
    // And will **extend** the config's default ignores, not override them
    // You can also pass a function to modify the default ignores
    ignores: [
        "**/fixtures",
    // ...globs
    ],

    // Parse the `.gitignore` file to get the ignores, on by default
    gitignore: true,

    // Or customize the stylistic rules
    stylistic: {
        indent: 4, // 4, or 'tab'
        quotes: "double", // or 'double'
        semi: true,
    },

    // TypeScript and Vue are autodetected, you can also explicitly enable them:
    typescript: true,
    vue: true,

    // Disable jsonc and yaml support
    jsonc: false,
    yaml: false,
});
