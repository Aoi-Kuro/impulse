"""
Prepare superbase/edge-functions/*.ts for `supabase functions deploy`.

The repo keeps each Edge Function as one file (check-ban.ts, post-message.ts,
...), but the Supabase CLI wants supabase/functions/<name>/index.ts. This
copies them into that layout in a temporary folder (the repo is not changed)
and prints the deploy command.

Usage:
    python stage_functions.py <project-ref>
"""

import shutil
import sys
import tempfile
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "edge-functions"


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    ref = sys.argv[1]
    out = Path(tempfile.mkdtemp(prefix="edge-functions-"))
    names = []
    for f in sorted(SRC.glob("*.ts")):
        target = out / "supabase" / "functions" / f.stem
        target.mkdir(parents=True)
        shutil.copy(f, target / "index.ts")
        names.append(f.stem)
    print(f"{len(names)} functions staged in {out}:")
    print("  " + ", ".join(names))
    print("\nDeploy all of them (JWT verification off, as the site expects):")
    print(f'  cd "{out}"')
    print(f"  npx supabase functions deploy --remote={ref} --no-verify-jwt --use-api")
    print("\nDelete the folder afterwards.")


if __name__ == "__main__":
    main()
