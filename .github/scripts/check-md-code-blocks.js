// .github/scripts/check-md-code-blocks.js

const fs = require('fs');
const { Octokit } = require('@octokit/rest');

const MARKER = '<!-- markdown-code-block-checker -->';
const MAX_CODE_PREVIEW = 50;
const LOAD_COMMENTS_PER_PAGE = 10;

function isBotComment(comment, actor) {
  // Accept comments by GitHub Actions bot, or the workflow actor, or any Bot user
  return (
    (comment.user && (
      comment.user.type === 'Bot' ||
      comment.user.login === 'github-actions[bot]' ||
      comment.user.login === actor
    )) &&
    comment.body &&
    comment.body.includes(MARKER)
  );
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const actor = process.env.GITHUB_ACTOR;

  if (!token || !repoFull || !eventPath) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const [owner, repo] = repoFull.split('/');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const octokit = new Octokit({ auth: token });

  const body = event.issue?.body || event.pull_request?.body || '';
  const issue_number = event.issue?.number || event.pull_request?.number;
  const type = event.issue ? "issue" : "pull request";

  // Check for code blocks without language
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
          // Find the next line that is not empty and not a code block marker
          let codePreview = '';
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() && !lines[j].startsWith('```')) {
              codePreview = lines[j].trim();
              break;
            }
          }
          if (codePreview.length > MAX_CODE_PREVIEW) {
            codePreview = codePreview.slice(0, MAX_CODE_PREVIEW) + '...';
          }
          errors.push(
            `Line ${i + 1}: Missing language for code block. Code starts with: "${codePreview}"`
          );
        }
        insideCode = true;
      } else {
        insideCode = false;
      }
    }
  }

  // Find existing checker comment by the bot
  let checkerComment = null;
  let page = 1;
  while (true) {
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number,
      per_page: LOAD_COMMENTS_PER_PAGE,
      page,
    });
    if (comments.length === 0) break;
    for (const comment of comments) {
      if (isBotComment(comment, actor)) {
        checkerComment = comment;
        break;
      }
    }
    if (checkerComment || comments.length < 100) break;
    page++;
  }

  // Compose comment body
  let commentBody = '';
  if (errors.length > 0) {
    commentBody = [
      MARKER,
      `:warning: **Some code blocks in this ${type} description are missing a language identifier.**`,
      '',
      'Please specify a language after the opening triple backticks in your code snippets. Example:',
      '````markdown',
      '```python',
      'print("hello world")',
      '```',
      '````',
      '',
      '**Details:**',
      '```',
      errors.join('\n'),
      '```'
    ].join('\n');
  } else {
    commentBody = [
      MARKER,
      ':white_check_mark: All code blocks look OK! Thanks for following the style guide.'
    ].join('\n');
  }

  // Update or create comment if needed
  if (checkerComment) {
    // Only update if content changed
    if (checkerComment.body !== commentBody) {
      await octokit.issues.updateComment({
        owner,
        repo,
        comment_id: checkerComment.id,
        body: commentBody
      });
    }
  } else if (errors.length > 0) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number,
      body: commentBody
    });
  }

  // Fail if errors
  if (errors.length > 0) {
    console.error('Some code blocks are missing language identifiers.');
    process.exit(1);
  } else {
    console.log('All code blocks have language specified.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
