import chalk from 'chalk';
import { accessSync, constants, createWriteStream, writeFile as fsWriteFile } from 'fs';
import ncp from 'ncp';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { cwd, exit } from 'process';
import execa from 'execa';
import Listr from 'listr';
import { projectInstall } from 'pkg-install';
import { licenseText } from 'spdx-license-list/licenses/MIT';
import { writeFile as gitignoreWriteFile } from 'gitignore';
import http from 'http';
import https from 'https';

const writeFile = promisify(fsWriteFile);
const copy = promisify(ncp);
const writeGitignore = promisify(gitignoreWriteFile);

export const templateDefs = {
  javascript: { label: "Javascript" },
  typescript: { label: "Typescript" },
  dummy: { label: "Dummy", url: "https://github.com/atao-web/dummy-startup-kit.git" }
}

const request = async (url, method = 'GET', postData) => {

  const lib = (url.search(/^\s*https:\/\//) > -1) ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(/*params*/ url, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }

      const data = [];

      res.on('data', chunk => {
        data.push(chunk);
      });

      res.on('end', () => resolve(Buffer.concat(data).toString()));
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

async function cloneGit(options) {
  const result = await execa('git', ['clone', options.templateDirectory, basename(options.targetDirectory)], {
    cwd: dirname(options.targetDirectory),
  });
  if (result.failed) {
    return Promise.reject(new Error('Failed to initialize git'));
  }
  return;
}

async function copyTemplateFiles(options, embedded = true) {
  if (embedded) {
    return copy(options.templateDirectory, options.targetDirectory, {
      clobber: false,
    });
  } else {
    return cloneGit(options);
  }
}

async function createGitignore(options) { // TODO don't overwrite an existing file
  const file = createWriteStream(
    join(options.targetDirectory, '.gitignore'),
    { flags: 'a' }
  );
  return writeGitignore({
    type: 'Node',
    file: file,
  });
}

function copyrightYears(creationYear) {
  const now = new Date().getFullYear();
  const firstYear = +(creationYear || now);
  const prefix = now > firstYear ? firstYear + " - " : "";
  return prefix + now;
}

async function createLicense(options) { // TODO don't overwrite an existing file
  const targetPath = join(options.targetDirectory, 'LICENSE');
  const licenseContent = licenseText
    .replace('<year>', copyrightYears(options.creationYear))
    .replace('<copyright holders>', `${options.copyrightHolders}`);
  return writeFile(targetPath, licenseContent, 'utf8');
}

async function initGit(options) {
  const result = await execa('git', ['init'], {
    cwd: options.targetDirectory,
  });
  if (result.failed) {
    return Promise.reject(new Error('Failed to initialize git'));
  }
  return;
}

export async function createProject(options) {
  options = {
    ...options,
    targetDirectory: options.targetDirectory || cwd(),
    copyrightHolders: 'Pierre Raoul',
    creationYear: 2019
  };

  const templateTag = options.template.toLowerCase();
  const template = templateDefs[templateTag];
  console.log("createProject with template: ", template)

  const currentFileUrl = import.meta.url;
  const templateDir = template && template.url ? template.url : resolve(
    new URL(currentFileUrl).pathname,
    '../../templates',
    templateTag
  );
  options.templateDirectory = templateDir;

  const tasks = new Listr([
    {
      title: 'Copy project files',
      task: ctx => copyTemplateFiles(options, ctx.embedded),
    },
    {
      title: 'Create gitignore',
      task: () => createGitignore(options),
    },
    {
      title: 'Create License',
      task: () => createLicense(options),
    },
    {
      title: 'Initialize git',
      task: () => initGit(options),
      enabled: () => options.git,
    },
    {
      title: 'Install dependencies',
      task: () =>
        projectInstall({
          cwd: options.targetDirectory,
        }),
      skip: () =>
        !options.runInstall
          ? 'Pass --install to automatically install dependencies'
          : undefined,
    },
  ]);

  try {
    const embedded = templateDir.search(/^\s*https?:\/\//) < 0;
    if (embedded) {
      accessSync(templateDir, constants.R_OK)
    } else {
      await request(templateDir.replace(/.git\s*$/, ''));
    }
    await tasks.run({ embedded });
    console.log('%s Project ready', chalk.green.bold('DONE'));
    return true;  
  } catch (err) {
    console.error('%s Invalid template name or url: %s', chalk.red.bold('ERROR'), err);
    exit(1);
  }

}
