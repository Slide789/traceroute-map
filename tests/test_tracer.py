from pathlib import Path

import pytest

from traceroute_map.tracer import InvalidTarget, build_command, run_trace, validate_target

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize("bad", ["", " ", "-h", "--help", "a b", "x;rm", "a&b", "a" * 254, "bad_host!", "-8.8.8.8"])
def test_validate_rejects(bad):
    with pytest.raises(InvalidTarget):
        validate_target(bad)


@pytest.mark.parametrize("good", ["google.com", " google.com ", "8.8.8.8", "2001:4860:4860::8888", "eu.battle.net"])
def test_validate_accepts(good):
    assert validate_target(good) == good.strip()


def test_build_command_windows():
    assert build_command("8.8.8.8", "Windows") == ["tracert", "-4", "-d", "-h", "30", "-w", "1000", "8.8.8.8"]


def test_build_command_linux():
    assert build_command("8.8.8.8", "Linux") == ["traceroute", "-n", "-m", "30", "-w", "1", "8.8.8.8"]


class FakeProcess:
    def __init__(self, lines):
        self.stdout = iter(lines)
        self.killed = False
        self.finished = False

    def poll(self):
        return 0 if (self.killed or self.finished) else None

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return 0


class FakePopen:
    def __init__(self):
        self.kwargs = None
        self.cmd = None
        self.process = None

    def factory(self, cmd, **kwargs):
        self.cmd = cmd
        self.kwargs = kwargs
        lines = (FIXTURES / "tracert_de.txt").read_text(encoding="utf-8").splitlines(keepends=True)
        self.process = FakeProcess(lines)
        return self.process

    @property
    def killed(self):
        return self.process.killed


@pytest.fixture
def fake_popen():
    return FakePopen()


def test_run_trace_yields_hops_and_uses_oem_on_windows(fake_popen):
    hops = list(run_trace("142.250.185.78", system="Windows", popen=fake_popen.factory))
    assert len(hops) == 5
    assert fake_popen.kwargs["encoding"] == "oem"
    assert fake_popen.kwargs["errors"] == "replace"
    assert fake_popen.cmd[0] == "tracert"


def test_closing_generator_kills_process(fake_popen):
    gen = run_trace("142.250.185.78", system="Windows", popen=fake_popen.factory)
    next(gen)
    gen.close()
    assert fake_popen.killed is True
