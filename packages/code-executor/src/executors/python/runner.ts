// The interpreter and all its modules belong to a disposable OS sandbox.
export const PYTHON_RUNNER = String.raw`
import ast, base64, contextlib, io, json, os, resource, sys, traceback
request = json.loads(sys.stdin.read())
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_AS, (request['memory'], request['memory']))
resource.setrlimit(resource.RLIMIT_FSIZE, (16777216, 16777216))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
limit = request['limit']
class Output(io.TextIOBase):
    def __init__(self):
        self.text = ''
        self.truncated = False
    def write(self, value):
        remaining = max(0, limit - len(self.text))
        self.text += value[:remaining]
        self.truncated |= len(value) > remaining
        return len(value)
    def result(self):
        text = self.text.rstrip('\n')
        return text + ('\n[Output truncated after %d characters]' % limit if self.truncated else '')
stdout, stderr = Output(), Output()
artifacts = []
artifact_bytes = 0
def create_artifact(fileName, content, type=None):
    global artifact_bytes
    if not isinstance(fileName, str) or not fileName or len(fileName) > 255 or '/' in fileName or '\\' in fileName:
        raise ValueError('Artifact filename must be a basename of at most 255 characters')
    data = content.encode() if isinstance(content, str) else bytes(content)
    artifact_bytes += len(data)
    if len(artifacts) >= 16 or artifact_bytes > 16777216:
        raise ValueError('Artifact limit exceeded (16 files / 16 MiB)')
    artifacts.append({'fileName': fileName, 'content': base64.b64encode(data).decode()})
namespace = {'__name__': '__main__', '__create_artifact__': create_artifact}
try:
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = request['code']
        if 'matplotlib' in code:
            import matplotlib
            matplotlib.use('Agg')
        tree = ast.parse(code, '<execution>', 'exec')
        expression = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        exec(compile(tree, '<execution>', 'exec'), namespace)
        if expression:
            result = eval(compile(ast.Expression(expression.value), '<execution>', 'eval'), namespace)
            if result is not None:
                if stdout.text and not stdout.text.endswith('\n'):
                    stdout.write('\n')
                stdout.write(str(result))
        if 'matplotlib.pyplot' in sys.modules:
            plt = sys.modules['matplotlib.pyplot']
            for index in plt.get_fignums():
                buffer = io.BytesIO()
                plt.figure(index).savefig(buffer, format='png', bbox_inches='tight')
                create_artifact('chart_%s.png' % index, buffer.getvalue(), 'image')
            plt.close('all')
    response = {'stdout': stdout.result(), 'stderr': stderr.result(), 'artifacts': artifacts}
except BaseException as error:
    response = {'error': {'name': error.__class__.__name__, 'message': str(error), 'stack': traceback.format_exc()[-16384:]}}
sys.__stdout__.write(json.dumps(response))
`;
