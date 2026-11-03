// Where the review images live: a folder with manifest.json and the images it lists, for example a
// Hugging Face dataset at a version tag, https://huggingface.co/datasets/<owner>/<repo>/resolve/<tag>/
// The GitHub Pages workflow rewrites this file from the repository variable RETIFY_DATA_URL.
// A ?data=<url> parameter in the page address overrides it (useful for a local test).
window.RETIFY_DATA_URL = "";
