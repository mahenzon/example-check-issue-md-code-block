// .github/scripts/check-md-code-blocks.js

/**
 * Checks a markdown string for code blocks without language names.
 * If any are found, comments on the PR/Issue and fails the workflow.
 *
 * Usage: node .github/scripts/check-md-code-blocks.js
 * Expects the following environment variables:
 *   - GITHUB_TOKEN
 *   - GITHUB_REPOSITORY
 *   - GITHUB_EVENT_PATH
 */

const fs = require('fs');
const { Octokit } = require('@octokit/rest');

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!token || !repoFull || !eventPath) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const [owner, repo] = repoFull.split('/');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

  const body = event.issue?.body || event.pull_request?.body || '';
  const lines = body.split('\n');
  let insideCode = false;
  let errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^```(\S*)/);
    if (match) {
      if (!insideCode) {
        const lang = match[1];
        if (!lang) {
          errors.push(`Line ${i + 1}: Missing language for code block`);
        }
        insideCode = true;
      } else {
        insideCode = false;
      }
    }
  }

  if (errors.length > 0) {
    const issue_number = event.issue?.number || event.pull_request?.number;
    const type = event.issue ? "issue" : "pull request";
    const commentBody = [
      `:warning: **Some code blocks in this ${type} description are missing a language identifier.**`,
      '',
      'Please specify a language after the opening triple backticks. Example:',
      '```python',
      'print("Hello world")',
      '```',
      '',
      '**Details:**',
      '```',
      errors.join('\n'),
      '```'
    ].join('\n');

    const octokit = new Octokit({ auth: token });
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number,
      body: commentBody
    });
    console.error('Some code blocks are missing language identifiers.');
    process.exit(1);
  } else {
    console.log('All code blocks have language specified.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
