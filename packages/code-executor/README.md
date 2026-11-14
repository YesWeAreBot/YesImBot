# YesImBot 扩展插件：代码执行器

为 YesImBot 提供 Python 计算、数据处理和文件产物工具 `execute_python`。

## 执行环境与兼容变化

Python 执行已从宿主进程内的 Pyodide 改为每次调用新建的 Linux bubblewrap + CPython 环境。旧的 `pyodideVersion`、`cdnBaseUrl`、`allowedModules`、`packages` 不再控制执行。升级时必须准备独立根文件系统并配置 `sandboxRoot`；仅保留旧配置会返回 `EnvironmentError`，不会回退到宿主执行。

需要 Linux、支持用户和网络等 namespace 的内核，以及支持 `--disable-userns` 和 `--size` 的 bubblewrap。部分 Docker、托管容器和系统策略禁止这些操作；启动探针失败时工具明确报错。Windows、macOS 请在符合条件的 Linux 环境部署。

每次执行使用独立进程、只读根文件系统、独立 PID/网络/用户等 namespace，以及临时 `/workspace` 和 `/tmp`。不继承宿主环境变量，不挂载宿主项目或数据目录；网络访问不可用。模块只来自管理员预装的 CPython 环境，执行时不自动联网安装。该边界依赖内核、bubblewrap 和管理员准备的根文件系统，不构成对内核漏洞或所有资源耗尽方式的绝对保护。

## 准备根文件系统

以下示例用于 Debian/Ubuntu 主机，命令由管理员执行。根文件系统不可包含机器人配置、密钥、SSH 凭据或其他宿主数据；不要使用 `/`、项目目录或已有业务系统的副本。不要以 root 身份运行机器人服务。

```bash
sudo apt-get update
sudo apt-get install bubblewrap debootstrap
sudo debootstrap --variant=minbase --include=python3,python3-numpy,python3-matplotlib bookworm /opt/yib-python-root https://deb.debian.org/debian
sudo mkdir -p /opt/yib-python-root/workspace /opt/yib-python-root/tmp /opt/yib-python-root/proc /opt/yib-python-root/dev
sudo chown -R root:root /opt/yib-python-root
sudo chmod 755 /opt/yib-python-root
```

按需要在这个根文件系统内安装其他发行版 Python 包；安装完成后再交给执行器使用。根文件系统本身对代码可读，因此其中任何数据都必须可公开给执行代码。管理员维护该环境的安全更新。

以运行机器人服务的同一用户验证主机支持情况：

```bash
bwrap --unshare-all --unshare-user --disable-userns --die-with-parent --new-session --cap-drop ALL --uid 65534 --gid 65534 \
  --ro-bind /opt/yib-python-root / --proc /proc --dev /dev \
  --perms 1777 --size 67108864 --tmpfs /tmp --perms 1777 --size 67108864 --tmpfs /workspace \
  --chdir /workspace --clearenv --setenv PATH /usr/bin:/bin --setenv HOME /workspace \
  -- /usr/bin/python3 -I -c 'import os, numpy; assert os.getuid() == 65534; open("/workspace/probe", "w").close(); open("/tmp/probe", "w").close(); print("sandbox-ready")'
```

若出现 namespace、权限或缺少解释器错误，先修复部署环境；不要改用宿主根目录、共享网络或关闭隔离参数绕过错误。

## 配置

```yaml
engines:
    python:
        type: python
        enabled: true
        sandboxRoot: /opt/yib-python-root
        bubblewrapPath: /usr/bin/bwrap
        pythonPath: /usr/bin/python3
        timeout: 30000
        poolSize: 2
        memoryLimitMiB: 512
shared:
    maxOutputSize: 10240
```

`poolSize` 限制同时运行的独立进程数量，不复用解释器。`timeout` 包含排队、计算和产物写入；超时、回复取消或插件停止会终止执行进程。虚拟内存上限为每进程限制，不是整个进程树的总内存配额；需要严格总资源配额时，应另在服务或容器层设置 cgroup 内存和进程数限制。

标准输出和错误输出分别截断到 `maxOutputSize` 个 Unicode 字符（上限 1 Mi 字符）。`/tmp` 和 `/workspace` 各限制为 64 MiB 临时空间，执行结束后清除。产物最多 16 个、合计 16 MiB；产物写入需要支持可取消资产创建的 YesImBot 核心版本，否则明确报错。

## 使用

```python
print(6 * 7)
__create_artifact__('result.txt', '计算结果：42')
```

最后一个表达式也会返回结果；使用 matplotlib 创建的图表会自动保存为图片产物。Python 异常、存储失败和超时通过工具错误结果返回。

## 部署验证

```bash
YIB_PYTHON_SANDBOX_ROOT=/opt/yib-python-root yarn vitest run packages/code-executor/tests/python-sandbox.spec.ts
```

此测试实际验证隔离环境中的宿主路径不可见、环境变量隔离、外网不可达、跨请求模块状态清除，以及 CPU 超时后仍能再次执行。未设置根目录时该部署测试会明确跳过；普通协议测试只执行受信任的 CPython 测试片段，不代表完成 OS 隔离验收。
