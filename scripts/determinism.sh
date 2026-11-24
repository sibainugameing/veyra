#!/usr/bin/env bash
# Appendix B #6: render twice with the cache disabled, compare frame hashes.
set -e
for n in a b; do rm -f .veyra/cache.json; ./target/release/veyra render >/dev/null; (cd .veyra/frames && sha256sum *.png) > /tmp/$n.txt; done
diff /tmp/a.txt /tmp/b.txt >/dev/null && echo "DETERMINISTIC: all frames identical" || echo "MISMATCH"
