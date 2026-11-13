from contextlib import contextmanager
import logging
import random as _py_random
import sys
from types import ModuleType


@contextmanager
def all_logging_disabled(highest_level=logging.CRITICAL):
    """
    A context manager that will prevent any logging messages
    triggered during the body from being processed.
    :param highest_level: the maximum logging level in use.
      This would only need to be changed if a custom level greater than CRITICAL
      is defined.
    """
    # two kind-of hacks here:
    #    * can't get the highest logging level in effect => delegate to the user
    #    * can't get the current module-level override => use an undocumented
    #       (but non-private!) interface

    previous_level = logging.root.manager.disable

    logging.disable(highest_level)

    try:
        yield
    finally:
        logging.disable(previous_level)


def ensure_numpy():
    """
    Ensures `import numpy as np` works even in minimal local Python environments
    where the third-party `numpy` wheel is not installed. If real `numpy` is
    installed (or running inside Pyodide), uses the native `numpy` package.
    """
    try:
        import numpy as np  # noqa: F401
        return np
    except ImportError:
        pass

    class _MiniArray:
        def __init__(self, data, dtype=None):
            self.dtype = dtype
            if isinstance(data, _MiniArray):
                self._data = self._deep_clone(data._data)
            elif isinstance(data, (list, tuple)):
                self._data = self._convert(data, dtype)
            else:
                self._data = data

        @classmethod
        def _convert(cls, obj, dtype):
            if isinstance(obj, (list, tuple)):
                return [cls._convert(x, dtype) for x in obj]
            if dtype is bool:
                return bool(obj)
            if dtype is int:
                return int(obj)
            return obj

        @classmethod
        def _deep_clone(cls, obj):
            if isinstance(obj, list):
                return [cls._deep_clone(x) for x in obj]
            return obj

        @property
        def shape(self):
            s = []
            cur = self._data
            while isinstance(cur, list):
                s.append(len(cur))
                cur = cur[0] if cur else None
            return tuple(s)

        def __len__(self):
            return len(self._data)

        def __iter__(self):
            for item in self._data:
                if isinstance(item, list):
                    yield _MiniArray(item, dtype=self.dtype)
                else:
                    yield item

        def __deepcopy__(self, memo):
            return _MiniArray(self._deep_clone(self._data), dtype=self.dtype)

        def _resolve_get(self, node, idx_tuple):
            if not idx_tuple:
                return node
            first, rest = idx_tuple[0], idx_tuple[1:]
            if isinstance(first, slice):
                return [self._resolve_get(child, rest) for child in node[first]]
            return self._resolve_get(node[int(first)], rest)

        def _resolve_set(self, node, idx_tuple, val):
            first, rest = idx_tuple[0], idx_tuple[1:]
            if not rest:
                if isinstance(first, slice):
                    indices = range(*first.indices(len(node)))
                    for i in indices:
                        node[i] = bool(val) if self.dtype is bool else val
                else:
                    node[int(first)] = bool(val) if self.dtype is bool else val
                return
            if isinstance(first, slice):
                indices = range(*first.indices(len(node)))
                for i in indices:
                    self._resolve_set(node[i], rest, val)
            else:
                self._resolve_set(node[int(first)], rest, val)

        def __getitem__(self, key):
            if isinstance(key, tuple):
                res = self._resolve_get(self._data, key)
            else:
                res = self._data[key]
            if isinstance(res, list):
                return _MiniArray(res, dtype=self.dtype)
            return res

        def __setitem__(self, key, value):
            if isinstance(key, tuple):
                self._resolve_set(self._data, key, value)
            else:
                self._data[key] = bool(value) if self.dtype is bool else value

        def _binary_op(self, other, op):
            other_data = other._data if isinstance(other, _MiniArray) else other

            def rec(a, b):
                if isinstance(a, list) and isinstance(b, (list, tuple)):
                    return [rec(x, y) for x, y in zip(a, b)]
                if isinstance(a, list):
                    return [rec(x, b) for x in a]
                if isinstance(b, (list, tuple)):
                    return [rec(a, y) for y in b]
                return op(a, b)

            return _MiniArray(rec(self._data, other_data), dtype=self.dtype)

        def __add__(self, other):
            return self._binary_op(other, lambda a, b: a + b)

        def __radd__(self, other):
            return self._binary_op(other, lambda a, b: b + a)

        def __sub__(self, other):
            return self._binary_op(other, lambda a, b: a - b)

        def __rsub__(self, other):
            return self._binary_op(other, lambda a, b: b - a)

        def __mul__(self, other):
            return self._binary_op(other, lambda a, b: a * b)

        def __rmul__(self, other):
            return self._binary_op(other, lambda a, b: b * a)

        def tolist(self):
            return self._deep_clone(self._data)

        def __repr__(self):
            return f"array({self._data!r})"

    def _build_filled(shape, fill_val, dtype):
        if isinstance(shape, int):
            shape = (shape,)
        else:
            shape = tuple(shape)

        def rec(dims):
            if len(dims) == 1:
                return [fill_val for _ in range(dims[0])]
            return [rec(dims[1:]) for _ in range(dims[0])]

        return _MiniArray(rec(shape), dtype=dtype)

    def zeros(shape, dtype=float):
        val = False if dtype is bool else (0 if dtype is int else 0.0)
        return _build_filled(shape, val, dtype)

    def ones(shape, dtype=float):
        val = True if dtype is bool else (1 if dtype is int else 1.0)
        return _build_filled(shape, val, dtype)

    def asarray(a, dtype=None):
        if isinstance(a, _MiniArray):
            return _MiniArray(a, dtype=dtype or a.dtype)
        if isinstance(a, (list, tuple)):
            return _MiniArray(list(a), dtype=dtype)
        return _MiniArray([a], dtype=dtype)

    def array_equal(a, b):
        ta = tuple(a.tolist() if isinstance(a, _MiniArray) else a)
        tb = tuple(b.tolist() if isinstance(b, _MiniArray) else b)
        return ta == tb

    def _sum_nested(obj):
        if isinstance(obj, _MiniArray):
            return _sum_nested(obj._data)
        if isinstance(obj, (list, tuple)):
            return sum(_sum_nested(x) for x in obj)
        return obj

    class _RandomNamespace:
        @staticmethod
        def seed(s=None):
            _py_random.seed(s)

        @staticmethod
        def randint(low, high=None, size=None):
            if high is None:
                high = low
                low = 0
            if size is None:
                return _py_random.randrange(int(low), int(high))
            if isinstance(size, int):
                return _MiniArray(
                    [_py_random.randrange(int(low), int(high)) for _ in range(size)],
                    dtype=int,
                )
            return _MiniArray(
                [_py_random.randrange(int(low), int(high)) for _ in range(size[0])],
                dtype=int,
            )

    np_mod = ModuleType("numpy")
    np_mod.ndarray = _MiniArray
    np_mod.zeros = zeros
    np_mod.ones = ones
    np_mod.asarray = asarray
    np_mod.array = asarray
    np_mod.array_equal = array_equal
    np_mod.sum = _sum_nested
    np_mod.max = max
    np_mod.round = round
    np_mod.random = _RandomNamespace()
    sys.modules["numpy"] = np_mod
    return np_mod
