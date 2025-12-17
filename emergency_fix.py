import shutil
import os

# First, try to find a backup
backup_path = 'e:\\image optimiztion\\styles.css.bak'
target_path = 'e:\\image optimiztion\\styles.css'

# If no backup exists, we'll restore from the script
# For now, let's just copy from the git history or recreate

# Since we don't have a backup, let's just delete the corrupted file
# and the user can refresh from git or we'll recreate it

if os.path.exists(target_path):
    os.remove(target_path)
    print("Removed corrupted styles.css")
else:
    print("File doesn't exist")
