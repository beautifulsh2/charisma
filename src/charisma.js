import { GoogleGenAI } from "@google/genai";
import chalk from 'chalk';
import readlineSync from 'readline-sync';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import cliHighlight from 'cli-highlight';
import axios from 'axios';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const historyPath = path.resolve('./charisma_history.json');
const outputDir = path.resolve('./generated');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const formatters = {
  'C': { cmd: 'clang-format -i', ext: '.c' },
  'C++': { cmd: 'clang-format -i', ext: '.cpp' },
  'Python': { cmd: 'black', ext: '.py' },
  'JavaScript': { cmd: 'prettier --write', ext: '.js' },
  'Java': { cmd: 'clang-format -i', ext: '.java' },
  'Go': { cmd: 'gofmt -w', ext: '.go' },
  'Ruby': { cmd: 'rufo', ext: '.rb' }
};

const languageSelector = () => {
  const options = Object.keys(formatters);
  const index = readlineSync.keyInSelect(options, 'Select language:');
  return index === -1 ? 'JavaScript' : options[index];
};

const getPrompt = () => readlineSync.question(chalk.green('‹ Enter Prompt: ')).trim();

const getFilename = (base, ext) => {
  const safe = base.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return path.join(outputDir, `${safe}${ext}`);
};

const checkFormatter = (lang) => {
  const formatter = formatters[lang];
  try {
    execSync(`${formatter.cmd.split(' ')[0]} --version`, { stdio: 'ignore' });
    return formatter.cmd;
  } catch {
    return null;
  }
};

const generateCode = async (prompt, lang) => {
  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `generate code in ${lang} based on this prompt: ${prompt} and return just the raw code with no backticks`
  });
  return result.text;
};

const writeCode = (filename, code) => {
  fs.writeFileSync(filename, code);
  console.log(chalk.bold.green(`Saved to ${filename}`));
};

const formatCode = (cmd, file) => {
  try {
    execSync(`${cmd} ${file}`);
    console.log(chalk.cyan('Code formatted'));
  } catch {
    console.log(chalk.red('Formatter error'));
  }
};

const previewCode = (code, lang) => {
  const highlight = cliHighlight.highlight(code, { language: lang.toLowerCase(), ignoreIllegals: true });
  console.log(chalk.blue('\n› Preview:\n'));
  console.log(highlight);
};

const copyToClipboard = (code) => {
  try {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
    execSync(`echo "${code}" | ${cmd}`);
    console.log(chalk.magenta('Copied to clipboard'));
  } catch {}
};

const saveHistory = (prompt, code, lang, file) => {
  let history = [];
  if (fs.existsSync(historyPath)) {
    history = JSON.parse(fs.readFileSync(historyPath));
  }
  history.push({ timestamp: new Date().toISOString(), prompt, lang, file });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
};

const viewHistory = () => {
  if (!fs.existsSync(historyPath)) return console.log(chalk.yellow('No history yet.'));
  const history = JSON.parse(fs.readFileSync(historyPath));
  console.log(chalk.bold('\n› History:'));
  history.slice(-5).forEach((item, i) => {
    console.log(`${i + 1}. [${item.lang}] → ${chalk.yellow(item.prompt)} (${item.file})`);
  });
};

const clearScreen = () => process.stdout.write('\x1Bc');

const createGist = async (filename, code, token, description, isPrivate) => {
  const gistData = {
    description: description || 'Generated Code Gist',
    public: !isPrivate,
    files: {
      [filename]: {
        content: code
      }
    }
  };

  try {
    const response = await axios.post('https://api.github.com/gists', gistData, {
      headers: {
        Authorization: `token ${token}`,
      }
    });
    console.log(chalk.green(`Gist created: ${response.data.html_url}`));
  } catch (error) {
    console.log(chalk.red('Failed to create Gist:', error.message));
  }
};

const main = async () => {
  while (true) {
    clearScreen();
    console.log(chalk.bold.rgb(255, 223, 0)('\nCharisma'));
    console.log(chalk.bold.green('Coding Agent'));

    const menu = ['New Code', 'View History', 'Create GitHub Gist', 'Exit'];
    const choice = readlineSync.keyInSelect(menu, 'Select option:');
    if (choice === -1 || menu[choice] === 'Exit') break;
    if (menu[choice] === 'View History') {
      viewHistory();
      readlineSync.question(chalk.gray('\nPress Enter to return...'));
      continue;
    }

    if (menu[choice] === 'Create GitHub Gist') {
      const token = readlineSync.question(chalk.yellow('Enter your GitHub token: '));
      const description = readlineSync.question(chalk.yellow('Enter a description for the Gist (optional): '));
      const isPrivate = readlineSync.keyInYNStrict('Should the Gist be private?');
      const filename = readlineSync.question(chalk.green('Enter Gist filename (with extension): '));
      const code = fs.readFileSync(filename, 'utf-8');
      await createGist(filename, code, token, description, isPrivate);
      continue;
    }

    const prompt = getPrompt();
    const lang = languageSelector();
    const ext = formatters[lang].ext;
    const filename = getFilename(prompt, ext);
    console.log(chalk.blue('Generating code...'));

    try {
      const code = await generateCode(prompt, lang);
      const preview = readlineSync.keyInYNStrict('Preview code in terminal?');
      if (preview) previewCode(code, lang);

      writeCode(filename, code);

      const formatterCmd = checkFormatter(lang);
      if (formatterCmd) {
        const shouldFormat = readlineSync.keyInYNStrict(`Format with ${formatterCmd.split(' ')[0]}?`);
        if (shouldFormat) formatCode(formatterCmd, filename);
      }

      const shouldCopy = readlineSync.keyInYNStrict('Copy code to clipboard?');
      if (shouldCopy) copyToClipboard(code);

      saveHistory(prompt, code, lang, filename);

      readlineSync.question(chalk.gray('\nDone. Press Enter to return...'));
    } catch (err) {
      console.log(chalk.red('\nSomething went wrong:'), err.message);
      readlineSync.question(chalk.gray('\nPress Enter to return...'));
    }
  }
};

main();
