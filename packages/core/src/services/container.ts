export class ServiceContainer {
    private services = new Map<string, any>();

    register<T>(name: string, instance: T): this {
        this.services.set(name, instance);
        return this;
    }

    get<T>(name: string): T {
        if (!this.services.has(name)) {
            throw new ServiceNotFoundError(name);
        }
        return this.services.get(name) as T;
    }
}

export class ServiceNotFoundError extends Error {
    constructor(serviceName: string) {
        super(`Service '${serviceName}' not found in container`);
        this.name = 'ServiceNotFoundError';
    }
}
