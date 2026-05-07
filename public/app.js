const searchForm = document.getElementById("searchForm");
const queryInput = document.getElementById("queryInput");
const resultsRoot = document.getElementById("results");
const statusText = document.getElementById("status");
const scrollSentinel = document.getElementById("scrollSentinel");
const thumbModal = document.getElementById("thumbModal");
const thumbModalImage = document.getElementById("thumbModalImage");
const thumbModalBackdrop = document.getElementById("thumbModalBackdrop");

let currentQuery = "";
let nextPageToken = null;
let isLoading = false;
let hasSearched = false;
let modalCloseTimer = null;

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  currentQuery = query;
  nextPageToken = null;
  hasSearched = true;
  resultsRoot.innerHTML = "";
  await loadMoreResults();
});

async function loadMoreResults() {
  if (isLoading || !currentQuery) return;
  isLoading = true;
  statusText.textContent = nextPageToken ? "Loading more videos..." : "Searching...";

  try {
    const params = new URLSearchParams({ q: currentQuery });
    if (nextPageToken) {
      params.set("pageToken", nextPageToken);
    }

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Search failed.");
    }

    renderResults(data.results || []);
    nextPageToken = data.nextPageToken || null;
    updateStatus();
  } catch (error) {
    statusText.textContent = `Error: ${error.message}`;
  } finally {
    isLoading = false;
  }
}

function renderResults(results) {
  if (!results.length) {
    if (!resultsRoot.children.length) {
      resultsRoot.innerHTML = "<p>No videos found.</p>";
    }
    return;
  }
  for (const video of results) {
    const card = document.createElement("article");
    card.className = "video-card";

    const publishedDate = video.publishedAt
      ? new Date(video.publishedAt).toLocaleString()
      : "Unknown";

    card.innerHTML = `
      <div class="thumb-wrap">
        <img
          class="thumb"
          loading="lazy"
          src="${video.thumbnailProxyUrl}"
          data-preview-src="${video.thumbnailPreviewUrl || video.thumbnailProxyUrl}"
          alt="Thumbnail for ${escapeHtml(video.title)}"
        />
        <span class="thumb-hint">Hover to preview</span>
      </div>
      <div class="meta">
        <h2>${escapeHtml(video.title)}</h2>
        <p class="channel-name">Channel: ${escapeHtml(video.channelTitle || "Unknown channel")}</p>
        <div class="meta-row">
          <span class="chip">${escapeHtml(publishedDate)}</span>
          <span class="chip">${Number(video.viewCount || 0).toLocaleString()} views</span>
          <span class="chip">${escapeHtml(video.duration || "Unknown")}</span>
        </div>
        <p class="description">${escapeHtml(video.description || "")}</p>
        <div class="actions">
          <button type="button" class="copy-btn">Copy Video Link</button>
          <a href="${video.videoProxyUrl}" target="_blank" rel="noopener noreferrer">Watch (proxied)</a>
        </div>
      </div>
    `;

    const thumb = card.querySelector(".thumb");
    thumb.addEventListener("error", () => {
      thumb.src = "/assets/thumb-fallback.svg";
      thumb.classList.add("thumb-fallback");
    });
    thumb.addEventListener("mouseenter", () => {
      const previewUrl = thumb.dataset.previewSrc || thumb.src;
      openThumbModal(previewUrl);
    });
    thumb.addEventListener("mouseleave", queueCloseModal);

    const copyBtn = card.querySelector(".copy-btn");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(video.videoUrl);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy Video Link";
        }, 1500);
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });

    resultsRoot.appendChild(card);
  }
}

function updateStatus() {
  if (!hasSearched) {
    statusText.textContent = "";
    return;
  }

  const count = resultsRoot.querySelectorAll(".video-card").length;
  if (!count) {
    statusText.textContent = "No videos found.";
    return;
  }

  if (nextPageToken) {
    statusText.textContent = `${count} videos loaded. Scroll down for more.`;
  } else {
    statusText.textContent = `${count} videos loaded. End of results.`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const observer = new IntersectionObserver(
  (entries) => {
    const [entry] = entries;
    if (!entry?.isIntersecting) return;
    if (!nextPageToken) return;
    loadMoreResults();
  },
  {
    root: null,
    rootMargin: "260px",
    threshold: 0
  }
);

observer.observe(scrollSentinel);

thumbModal.addEventListener("mouseenter", () => {
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
  }
});
thumbModal.addEventListener("mouseleave", queueCloseModal);
thumbModalBackdrop.addEventListener("click", closeThumbModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeThumbModal();
  }
});

function openThumbModal(src) {
  if (!src) return;
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
  }
  thumbModalImage.src = src;
  thumbModal.classList.add("open");
  thumbModal.setAttribute("aria-hidden", "false");
}

function queueCloseModal() {
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
  }
  modalCloseTimer = setTimeout(() => {
    closeThumbModal();
  }, 120);
}

function closeThumbModal() {
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
  }
  thumbModal.classList.remove("open");
  thumbModal.setAttribute("aria-hidden", "true");
  thumbModalImage.src = "";
}
