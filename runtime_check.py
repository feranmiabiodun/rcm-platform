# runtime_check.py
import importlib, sys, os, traceback, inspect

project_root = os.path.abspath(os.path.dirname(__file__))
backend_path = os.path.join(project_root, "backend")

# make sure backend and project root are on sys.path so imports resolve like production would
for p in (project_root, backend_path):
    if p not in sys.path:
        sys.path.insert(0, p)

files = [
    ("backend.main", "backend/main.py"),
    ("backend.ai_mocks", "backend/ai_mocks.py"),
    ("backend.humaein_sim", "backend/humaein_sim.py"),
    ("backend.db_store", "backend/db_store.py"),
]

def pretty_print_members(mod):
    funcs = [name for name, obj in inspect.getmembers(mod, inspect.isfunction) if obj.__module__ == mod.__name__]
    classes = [name for name, obj in inspect.getmembers(mod, inspect.isclass) if obj.__module__ == mod.__name__]
    print("  functions:", funcs[:20])
    print("  classes  :", classes[:20])

for mod_name, path in files:
    print("\n" + "="*72)
    print(f"Trying import: {mod_name}  (expected file: {path})")
    try:
        mod = importlib.import_module(mod_name)
    except Exception as e:
        print("IMPORT FAILED:")
        traceback.print_exc()
        # show whether the file exists where we expect it
        expected = os.path.join(project_root, *mod_name.split(".")) + ".py"
        print("\nFile existence checks:")
        print(" expected file:", expected, "->", os.path.exists(expected))
        alt = os.path.join(backend_path, *mod_name.replace("backend.", "").split(".")) + ".py"
        print(" backend-mapped:", alt, "->", os.path.exists(alt))
        # also list directory contents where python would look for it
        top = mod_name.split(".")[0]
        print("\nTop-level folders in project root:", [d for d in os.listdir(project_root) if os.path.isdir(os.path.join(project_root, d))][:50])
        continue
    print("IMPORT OK")
    pretty_print_members(mod)

print("\n\nDiagnostic finished.")
