import os
from pathlib import Path


class FileProcessor:
    @staticmethod
    def get_sub_dirs(directory):
        directory_path = Path(directory)
        sub_dirs = []
        for subdirectory in directory_path.iterdir():
            if subdirectory.is_dir():
                sub_dirs.append(subdirectory.name)
        return sub_dirs

    @staticmethod
    def get_script_files(directory):
        return [file[:-3] for file in os.listdir(directory) if file.endswith('.js')]

    @staticmethod
    def write_content(directory, script_files):
        return f"""
        let {directory.replace('/', '_')}_scripts = [{', '.join("'" + f + "'" for f in script_files)}]
        let {directory.replace('/', '_')}_paths = {directory.replace('/', '_')}_scripts.map(this._convertScriptToPath.bind(this, '{directory}'));
"""

    @staticmethod
    def get_concat_str(directories):
        return ', '.join(f"{directory.replace('/', '_')}_paths" for directory in directories)


class JSFileContent:
    def __init__(self, directories):
        self.directories = directories
        self.file_processor = FileProcessor()
        self.js_file_content = """
class ScriptDefinitions {
    _convertScriptToPath(directory, scriptName) {
        return directory + '/' + scriptName + '.js';
    }

    getScriptPaths() {"""

    def generate_content(self):
        for directory in self.directories:
            script_files = self.file_processor.get_script_files(directory)
            self.js_file_content += self.file_processor.write_content(directory, script_files)

        concat_str = self.file_processor.get_concat_str(self.directories)
        self.js_file_content += f"""
        return [].concat({concat_str}); """
        self.js_file_content += """
    }
}"""


class FileWriter:
    @staticmethod
    def write_file(js_file_content):
        js_path: Path = Path(os.path.dirname(__file__)).joinpath('init', 'script-definitions.js')
        with open(js_path, 'w') as file:
            file.write(js_file_content)


if __name__ == '__main__':
    directories = ['lib', 'src']
    walked_directories = []

    for directory in directories:
        sub_directories = FileProcessor.get_sub_dirs(directory)
        walked_directories.extend([f"{directory}/{sub_directory}" for sub_directory in sub_directories])
        walked_directories.append(directory)

    js_content = JSFileContent(walked_directories)
    js_content.generate_content()
    FileWriter.write_file(js_content.js_file_content)
