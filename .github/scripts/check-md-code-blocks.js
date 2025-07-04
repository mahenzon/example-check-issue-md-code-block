// .github/scripts/check-md-code-blocks.js

const fs = require('fs');
const { Octokit } = require('@octokit/rest');

const MARKER = '<!-- markdown-code-block-checker -->';
const MAX_CODE_PREVIEW = 50;
const LOAD_COMMENTS_PER_PAGE = 10;

function isBotComment(comment, actor) {
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

function fixCodeBlocks(body) {
  // Replace ```\n or ```\r\n with ```python\n
  // Only if there's no language after ```
  const lines = body.split('\n');
  let insideCode = false;
  let fixed = false;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^```(\s*)$/);
    if (match && !insideCode) {
      lines[i] = '```python';
      fixed = true;
      insideCode = true;
    } else if (lines[i].startsWith('```') && insideCode) {
      insideCode = false;
    }
  }
  return { fixedBody: lines.join('\n'), fixed };
}

function findMissingLangBlocks(body) {
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
  return errors;
}

async function getCheckerComment(octokit, owner, repo, issue_number, actor) {
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
  return checkerComment;
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

  let body = event.issue?.body || event.pull_request?.body || '';
  const issue_number = event.issue?.number || event.pull_request?.number;
  const type = event.issue ? "issue" : "pull request";
  const isPR = !!event.pull_request;

  // 1. Check for missing languages in the original body
  const errors = findMissingLangBlocks(body);

  // 2. Prepare comment and fixed body if needed
  let commentBody = '';
  let fixedBody = body;
  let fixed = false;

  if (errors.length > 0) {
    // Prepare fixed body
    const fixResult = fixCodeBlocks(body);
    fixedBody = fixResult.fixedBody;
    fixed = fixResult.fixed;

    // Prepare comment (no re-checking after fix!)
    commentBody = [
      MARKER,
      `:information_source: All code blocks without a language in this ${type} description were set to \`python\` by default.`,
      '',
      '**You must check if the language was guessed correctly.**',
      '',
      '> In the future, please specify the language after the opening triple backticks in your code snippets.',
      '',
      'Example:',
      '````markdown',
      '```python',
      'print("hello world")',
      '```',
      '````'
    ].join('\n');
  }

  // 3. Find existing checker comment by the bot
  const checkerComment = await getCheckerComment(octokit, owner, repo, issue_number, actor);

  // 4. Only update if needed
  if (errors.length > 0 && fixed && body !== fixedBody) {
    // Update the issue or PR body
    if (isPR) {
      await octokit.pulls.update({
        owner,
        repo,
        pull_number: issue_number,
        body: fixedBody
      });
    } else {
      await octokit.issues.update({
        owner,
        repo,
        issue_number,
        body: fixedBody
      });
    }
    // Add or update the bot comment
    if (checkerComment) {
      if (checkerComment.body !== commentBody) {
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: checkerComment.id,
          body: commentBody
        });
      }
    } else {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number,
        body: commentBody
      });
    }
    // Always exit 0: we've fixed everything we could
    console.log('Fixed missing code block languages and notified the user.');
    process.exit(0);
  } else if (checkerComment && errors.length === 0) {
    // If everything is OK and there was a previous comment, delete it
    await octokit.issues.deleteComment({
      owner,
      repo,
      comment_id: checkerComment.id
    });
    console.log('All code blocks have language specified. Thank you.');
    process.exit(0);
  } else {
    // All code blocks are OK and no bot comment exists
    console.log('All code blocks have language specified.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
