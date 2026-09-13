(function () {
  "use strict";

  const { createClient } = window.supabase;

  const supabaseClient = createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  const TEMPLATE_BUCKET = "pledge-templates";
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const MAX_TEMPLATE_DIMENSION = 1600;

  let selectedPhotoFile = null;
  let selectedPhotoImg = null;
  let currentTemplate = null;

  let editorArea = {
    xPct: 25,
    yPct: 25,
    wPct: 50,
    hPct: 50
  };

  let editorShape = "rect";
  let editorRadius = 18;
  let editorFit = "cover";
  let editorImgNatural = {
    w: 0,
    h: 0
  };

  // ============================================================
  // BASIC HELPERS
  // ============================================================

  function showError(id, message) {
    const element = document.getElementById(id);

    if (!element) return;

    element.textContent = message;
    element.classList.add("visible");
  }

  function hideError(id) {
    const element = document.getElementById(id);

    if (!element) return;

    element.textContent = "";
    element.classList.remove("visible");
  }

  function isAdminRoute() {
    return location.hash === "#admin";
  }

  function showPanel(id) {
    document
      .querySelectorAll("#publicView .panel")
      .forEach(panel => panel.classList.remove("visible"));

    const panel = document.getElementById(id);

    if (panel) {
      panel.classList.add("visible");
    }
  }

  function setStep(stepNumber) {
    document.querySelectorAll(".step").forEach(step => {
      const number = parseInt(step.dataset.step, 10);

      step.classList.toggle("active", number === stepNumber);
      step.classList.toggle("done", number < stepNumber);
    });

    document
      .getElementById("line1")
      .classList.toggle("done", stepNumber > 1);

    document
      .getElementById("line2")
      .classList.toggle("done", stepNumber > 2);
  }

  // ============================================================
  // IMAGE VALIDATION
  // ============================================================

  function detectImageSignature(bytes) {
    // JPEG
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return "image/jpeg";
    }

    // PNG
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }

    // WEBP
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }

    return null;
  }

  function readFileHeader(file, numberOfBytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        resolve(new Uint8Array(reader.result));
      };

      reader.onerror = () => {
        reject(reader.error);
      };

      reader.readAsArrayBuffer(file.slice(0, numberOfBytes));
    });
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = reject;

      image.src = source;
    });
  }

  // ============================================================
  // PUBLIC TEMPLATE
  // ============================================================

  async function getPublishedTemplate() {
    const { data, error } = await supabaseClient
      .from("templates")
      .select("*")
      .eq("published", true)
      .order("updated_at", {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Template error:", error);
      throw error;
    }

    return data;
  }

  async function renderPublic() {
    resetUploadUI();

    try {
      currentTemplate = await getPublishedTemplate();

      if (!currentTemplate) {
        showPanel("panelUnavailable");
        return;
      }

      showPanel("panelUpload");
      setStep(1);

    } catch (error) {
      console.error(error);
      showPanel("panelUnavailable");
    }
  }

  function resetUploadUI() {
    selectedPhotoFile = null;
    selectedPhotoImg = null;

    const input = document.getElementById("fileInput");

    if (input) {
      input.value = "";
    }

    const thumbRow = document.getElementById("thumbRow");

    if (thumbRow) {
      thumbRow.style.display = "none";
    }

    const actions = document.getElementById("uploadActions");

    if (actions) {
      actions.style.display = "none";
    }

    hideError("uploadError");
  }

  // ============================================================
  // PUBLIC PHOTO UPLOAD
  // ============================================================

  async function handleFileSelected(file) {
    hideError("uploadError");

    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      showError(
        "uploadError",
        "That file is larger than 10 MB. Please choose a smaller photo."
      );
      return;
    }

    let header;

    try {
      header = await readFileHeader(file, 16);
    } catch (error) {
      showError(
        "uploadError",
        "We couldn't read that file. Please try a different photo."
      );
      return;
    }

    if (!detectImageSignature(header)) {
      showError(
        "uploadError",
        "That doesn't look like a supported photo. Please upload a JPG, PNG or WEBP image."
      );
      return;
    }

    selectedPhotoFile = file;

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      selectedPhotoImg = image;

      document.getElementById("thumbImg").src = url;

      document.getElementById("thumbName").textContent =
        file.name || "Your photo";

      document.getElementById("thumbSize").textContent =
        (file.size / 1024 / 1024).toFixed(1) + " MB";

      document.getElementById("thumbRow").style.display = "flex";

      document.getElementById("uploadActions").style.display = "flex";
    };

    image.onerror = () => {
      showError(
        "uploadError",
        "This image file appears to be corrupted. Please try another photo."
      );
    };

    image.src = url;
  }

  // ============================================================
  // PUBLIC COMPOSITING
  // ============================================================

  function clipShapePath(
    context,
    x,
    y,
    width,
    height,
    shape,
    radiusPct
  ) {
    context.beginPath();

    if (shape === "circle") {
      const radius = Math.min(width, height) / 2;

      context.arc(
        x + width / 2,
        y + height / 2,
        radius,
        0,
        Math.PI * 2
      );

    } else if (shape === "rounded") {
      const radius =
        Math.min(width, height) /
        2 *
        (Math.max(0, Math.min(100, radiusPct || 0)) / 100);

      const rounded = Math.min(
        radius,
        width / 2,
        height / 2
      );

      context.moveTo(x + rounded, y);

      context.arcTo(
        x + width,
        y,
        x + width,
        y + height,
        rounded
      );

      context.arcTo(
        x + width,
        y + height,
        x,
        y + height,
        rounded
      );

      context.arcTo(
        x,
        y + height,
        x,
        y,
        rounded
      );

      context.arcTo(
        x,
        y,
        x + width,
        y,
        rounded
      );

    } else {
      context.rect(
        x,
        y,
        width,
        height
      );
    }

    context.closePath();
  }

  async function compositeCard(template, photoImage) {
    const background = await loadImage(template.image_url);

    const canvas = document.createElement("canvas");

    canvas.width = template.width;
    canvas.height = template.height;

    const context = canvas.getContext("2d");

    context.drawImage(
      background,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const area = template.area;

    const boxX =
      (Number(area.xPct) / 100) *
      canvas.width;

    const boxY =
      (Number(area.yPct) / 100) *
      canvas.height;

    const boxW =
      (Number(area.wPct) / 100) *
      canvas.width;

    const boxH =
      (Number(area.hPct) / 100) *
      canvas.height;

    context.save();

    clipShapePath(
      context,
      boxX,
      boxY,
      boxW,
      boxH,
      template.shape,
      template.radiusPct
    );

    context.clip();

    const imageWidth =
      photoImage.naturalWidth ||
      photoImage.width;

    const imageHeight =
      photoImage.naturalHeight ||
      photoImage.height;

    if (template.fit === "contain") {

      const scale = Math.min(
        boxW / imageWidth,
        boxH / imageHeight
      );

      const drawWidth = imageWidth * scale;
      const drawHeight = imageHeight * scale;

      const drawX =
        boxX +
        (boxW - drawWidth) / 2;

      const drawY =
        boxY +
        (boxH - drawHeight) / 2;

      context.drawImage(
        photoImage,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );

    } else {

      const scale = Math.max(
        boxW / imageWidth,
        boxH / imageHeight
      );

      const sourceWidth =
        boxW / scale;

      const sourceHeight =
        boxH / scale;

      const sourceX =
        (imageWidth - sourceWidth) / 2;

      const sourceY =
        (imageHeight - sourceHeight) / 2;

      context.drawImage(
        photoImage,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        boxX,
        boxY,
        boxW,
        boxH
      );
    }

    context.restore();

    return canvas;
  }

  // ============================================================
  // PUBLIC EVENT HANDLERS
  // ============================================================

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");

  dropzone.addEventListener("click", () => {
    fileInput.click();
  });

  dropzone.addEventListener("dragover", event => {
    event.preventDefault();
    dropzone.classList.add("drag");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag");
  });

  dropzone.addEventListener("drop", event => {
    event.preventDefault();

    dropzone.classList.remove("drag");

    if (
      event.dataTransfer.files &&
      event.dataTransfer.files[0]
    ) {
      handleFileSelected(
        event.dataTransfer.files[0]
      );
    }
  });

  fileInput.addEventListener("change", event => {
    if (
      event.target.files &&
      event.target.files[0]
    ) {
      handleFileSelected(
        event.target.files[0]
      );
    }
  });

  document
    .getElementById("btnReplace")
    .addEventListener("click", () => {
      fileInput.click();
    });

  document
    .getElementById("btnGenerate")
    .addEventListener("click", async () => {

      if (!selectedPhotoImg || !currentTemplate) {
        return;
      }

      showPanel("panelGenerating");
      setStep(2);

      await new Promise(resolve =>
        setTimeout(resolve, 60)
      );

      try {

        const canvas = await compositeCard(
          currentTemplate,
          selectedPhotoImg
        );

        const output =
          document.getElementById("resultCanvas");

        output.width = canvas.width;
        output.height = canvas.height;

        output
          .getContext("2d")
          .drawImage(canvas, 0, 0);

        showPanel("panelResult");
        setStep(3);

        document.getElementById(
          "downloadFallbackHint"
        ).style.display = "none";

      } catch (error) {

        console.error(error);

        showPanel("panelUpload");

        showError(
          "uploadError",
          "Something went wrong generating your card. Please try again."
        );
      }
    });

  document
    .getElementById("btnAnother")
    .addEventListener("click", () => {

      resetUploadUI();

      showPanel("panelUpload");
      setStep(1);
    });

  document
    .getElementById("btnDownload")
    .addEventListener("click", () => {

      const canvas =
        document.getElementById("resultCanvas");

      const dataUrl =
        canvas.toDataURL(
          "image/png",
          1.0
        );

      try {

        const link =
          document.createElement("a");

        link.href = dataUrl;
        link.download = "my-pledge-card.png";

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        setTimeout(() => {

          document.getElementById(
            "downloadFallbackHint"
          ).style.display = "block";

        }, 400);

      } catch (error) {

        window.open(
          dataUrl,
          "_blank"
        );

        document.getElementById(
          "downloadFallbackHint"
        ).style.display = "block";
      }
    });

  // ============================================================
  // ADMIN ROUTING
  // ============================================================

  document
    .getElementById("adminLinkTrigger")
    .addEventListener("click", event => {

      event.preventDefault();

      location.hash = "#admin";
    });

  document
    .getElementById("backToPublicFromLogin")
    .addEventListener("click", event => {

      event.preventDefault();

      location.hash = "";
    });

  document
    .getElementById("adminLogout")
    .addEventListener("click", async event => {

      event.preventDefault();

      await supabaseClient.auth.signOut();

      location.hash = "";
    });

  // ============================================================
  // ADMIN AUTH
  // ============================================================

  async function renderAdmin() {

    const {
      data: {
        session
      }
    } = await supabaseClient.auth.getSession();

    if (session) {

      document.getElementById(
        "adminLogin"
      ).style.display = "none";

      document.getElementById(
        "adminEditor"
      ).style.display = "block";

      await loadTemplateIntoEditor();

    } else {

      document.getElementById(
        "adminLogin"
      ).style.display = "block";

      document.getElementById(
        "adminEditor"
      ).style.display = "none";
    }
  }

  document
    .getElementById("btnLogin")
    .addEventListener("click", async () => {

      const email =
        document
          .getElementById("adminEmail")
          ?.value
          ?.trim();

      const password =
        document.getElementById(
          "adminPassword"
        ).value;

      if (!email) {
        showError(
          "loginError",
          "Please enter your admin email."
        );
        return;
      }

      if (!password) {
        showError(
          "loginError",
          "Please enter your password."
        );
        return;
      }

      hideError("loginError");

      const {
        error
      } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {

        showError(
          "loginError",
          error.message
        );

        return;
      }

      await renderAdmin();
    });

  // ============================================================
  // TEMPLATE EDITOR
  // ============================================================

  const templateDropzone =
    document.getElementById(
      "templateDropzone"
    );

  const templateFileInput =
    document.getElementById(
      "templateFileInput"
    );

  templateDropzone.addEventListener(
    "click",
    () => templateFileInput.click()
  );

  templateFileInput.addEventListener(
    "change",
    event => {

      if (
        event.target.files &&
        event.target.files[0]
      ) {
        handleTemplateFileSelected(
          event.target.files[0]
        );
      }
    }
  );

  async function getAdminTemplate() {

    const {
      data,
      error
    } = await supabaseClient
      .from("templates")
      .select("*")
      .order("updated_at", {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      return null;
    }

    return data;
  }

  async function loadTemplateIntoEditor() {

    const template =
      await getAdminTemplate();

    const badge =
      document.getElementById(
        "templateStatusBadge"
      );

    const statusText =
      document.getElementById(
        "templateStatusText"
      );

    if (!template) {

      badge.classList.remove("live");

      statusText.textContent =
        "No template published";

      document.getElementById(
        "editorBody"
      ).style.display = "none";

      currentTemplate = null;

      return;
    }

    currentTemplate = template;

    badge.classList.toggle(
      "live",
      !!template.published
    );

    statusText.textContent =
      template.published
        ? "Template is live"
        : "Template saved (not published)";

    editorArea = {
      xPct: Number(template.area.xPct),
      yPct: Number(template.area.yPct),
      wPct: Number(template.area.wPct),
      hPct: Number(template.area.hPct)
    };

    editorShape =
      template.shape || "rect";

    editorRadius =
      Number(template.radiusPct || 18);

    editorFit =
      template.fit || "cover";

    editorImgNatural = {
      w: Number(template.width),
      h: Number(template.height)
    };

    document.getElementById(
      "editorImg"
    ).src = template.image_url;

    document.getElementById(
      "shapeSelect"
    ).value = editorShape;

    document.getElementById(
      "radiusRange"
    ).value = editorRadius;

    document.getElementById(
      "fitSelect"
    ).value = editorFit;

    document.getElementById(
      "editorBody"
    ).style.display = "block";

    document.getElementById(
      "radiusField"
    ).style.display =
      editorShape === "rounded"
        ? "block"
        : "none";

    syncNumFieldsFromArea();
    drawAreaBox();
  }

  // ============================================================
  // TEMPLATE IMAGE PROCESSING
  // ============================================================

  async function prepareTemplateImage(file) {

    const url =
      URL.createObjectURL(file);

    const image =
      await loadImage(url);

    let width =
      image.naturalWidth;

    let height =
      image.naturalHeight;

    let scale = 1;

    if (
      Math.max(width, height) >
      MAX_TEMPLATE_DIMENSION
    ) {

      scale =
        MAX_TEMPLATE_DIMENSION /
        Math.max(width, height);
    }

    width =
      Math.round(width * scale);

    height =
      Math.round(height * scale);

    const canvas =
      document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    canvas
      .getContext("2d")
      .drawImage(
        image,
        0,
        0,
        width,
        height
      );

    URL.revokeObjectURL(url);

    let blob;

    if (file.type === "image/jpeg") {

      blob =
        await new Promise(resolve =>
          canvas.toBlob(
            resolve,
            "image/jpeg",
            0.9
          )
        );

    } else {

      blob =
        await new Promise(resolve =>
          canvas.toBlob(
            resolve,
            "image/png"
          )
        );
    }

    return {
      blob,
      width,
      height
    };
  }

  async function handleTemplateFileSelected(file) {

    hideError("templateError");

    if (file.size > MAX_UPLOAD_BYTES) {

      showError(
        "templateError",
        "That file is larger than 10 MB. Please choose a smaller image."
      );

      return;
    }

    let header;

    try {

      header =
        await readFileHeader(
          file,
          16
        );

    } catch (error) {

      showError(
        "templateError",
        "We couldn't read that file."
      );

      return;
    }

    if (!detectImageSignature(header)) {

      showError(
        "templateError",
        "Please upload a JPG, PNG or WEBP image."
      );

      return;
    }

    try {

      const prepared =
        await prepareTemplateImage(file);

      const storagePath =
        `templates/${crypto.randomUUID()}.png`;

      const {
        error: uploadError
      } = await supabaseClient.storage
        .from(TEMPLATE_BUCKET)
        .upload(
          storagePath,
          prepared.blob,
          {
            contentType: "image/png",
            cacheControl: "3600",
            upsert: false
          }
        );

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: publicUrlData
      } =
        supabaseClient.storage
          .from(TEMPLATE_BUCKET)
          .getPublicUrl(
            storagePath
          );

      currentTemplate = {
        id: currentTemplate?.id || null,

        image_url:
          publicUrlData.publicUrl,

        width:
          prepared.width,

        height:
          prepared.height,

        area: {
          xPct: 25,
          yPct: 25,
          wPct: 50,
          hPct: 50
        },

        shape: "rect",

        radiusPct: 18,

        fit: "cover",

        published: false
      };

      editorArea =
        Object.assign(
          {},
          currentTemplate.area
        );

      editorShape = "rect";
      editorRadius = 18;
      editorFit = "cover";

      editorImgNatural = {
        w: prepared.width,
        h: prepared.height
      };

      document.getElementById(
        "editorImg"
      ).src =
        publicUrlData.publicUrl;

      document.getElementById(
        "shapeSelect"
      ).value = "rect";

      document.getElementById(
        "radiusRange"
      ).value = 18;

      document.getElementById(
        "fitSelect"
      ).value = "cover";

      document.getElementById(
        "radiusField"
      ).style.display = "none";

      document.getElementById(
        "editorBody"
      ).style.display = "block";

      syncNumFieldsFromArea();
      drawAreaBox();

      document.getElementById(
        "adminSaveMsg"
      ).textContent =
        "New design uploaded. Position the photo area, then Save & publish.";

    } catch (error) {

      console.error(error);

      showError(
        "templateError",
        error.message ||
        "The template could not be uploaded."
      );
    }
  }

  // ============================================================
  // EDITOR AREA
  // ============================================================

  function clampArea() {

    editorArea.wPct =
      Math.max(
        4,
        Math.min(
          100,
          editorArea.wPct
        )
      );

    editorArea.hPct =
      Math.max(
        4,
        Math.min(
          100,
          editorArea.hPct
        )
      );

    editorArea.xPct =
      Math.max(
        0,
        Math.min(
          100 - editorArea.wPct,
          editorArea.xPct
        )
      );

    editorArea.yPct =
      Math.max(
        0,
        Math.min(
          100 - editorArea.hPct,
          editorArea.yPct
        )
      );
  }

  function enforceCircleAspect() {

    if (
      editorShape !== "circle" ||
      !editorImgNatural.w ||
      !editorImgNatural.h
    ) {
      return;
    }

    editorArea.hPct =
      editorArea.wPct *
      (
        editorImgNatural.w /
        editorImgNatural.h
      );
  }

  function drawAreaBox() {

    const box =
      document.getElementById(
        "areaBox"
      );

    box.style.left =
      editorArea.xPct + "%";

    box.style.top =
      editorArea.yPct + "%";

    box.style.width =
      editorArea.wPct + "%";

    box.style.height =
      editorArea.hPct + "%";

    box.classList.toggle(
      "circle",
      editorShape === "circle"
    );

    box.style.borderRadius =
      editorShape === "rounded"
        ? Math.min(
            50,
            editorRadius / 2
          ) + "%"
        : editorShape === "circle"
        ? "50%"
        : "0";
  }

  function syncNumFieldsFromArea() {

    document.getElementById(
      "numX"
    ).value =
      Math.round(editorArea.xPct);

    document.getElementById(
      "numY"
    ).value =
      Math.round(editorArea.yPct);

    document.getElementById(
      "numW"
    ).value =
      Math.round(editorArea.wPct);

    document.getElementById(
      "numH"
    ).value =
      Math.round(editorArea.hPct);
  }

  ["numX", "numY", "numW", "numH"]
    .forEach(id => {

      document
        .getElementById(id)
        .addEventListener(
          "input",
          () => {

            editorArea.xPct =
              parseFloat(
                document.getElementById(
                  "numX"
                ).value
              ) || 0;

            editorArea.yPct =
              parseFloat(
                document.getElementById(
                  "numY"
                ).value
              ) || 0;

            editorArea.wPct =
              parseFloat(
                document.getElementById(
                  "numW"
                ).value
              ) || 1;

            editorArea.hPct =
              parseFloat(
                document.getElementById(
                  "numH"
                ).value
              ) || 1;

            if (
              editorShape === "circle"
            ) {
              enforceCircleAspect();
            }

            clampArea();
            syncNumFieldsFromArea();
            drawAreaBox();
          }
        );
      });

  document
    .getElementById("shapeSelect")
    .addEventListener(
      "change",
      event => {

        editorShape =
          event.target.value;

        document.getElementById(
          "radiusField"
        ).style.display =
          editorShape === "rounded"
            ? "block"
            : "none";

        if (
          editorShape === "circle"
        ) {

          enforceCircleAspect();
          clampArea();
          syncNumFieldsFromArea();
        }

        drawAreaBox();
      }
    );

  document
    .getElementById("radiusRange")
    .addEventListener(
      "input",
      event => {

        editorRadius =
          parseFloat(
            event.target.value
          ) || 0;

        drawAreaBox();
      }
    );

  document
    .getElementById("fitSelect")
    .addEventListener(
      "change",
      event => {

        editorFit =
          event.target.value;
      }
    );

  // ============================================================
  // DRAG + RESIZE
  // ============================================================

  (function setupDragResize() {

    const wrap =
      document.getElementById(
        "editorCanvasWrap"
      );

    const box =
      document.getElementById(
        "areaBox"
      );

    const handle =
      document.getElementById(
        "areaHandle"
      );

    let mode = null;
    let start = null;

    function getPoint(event) {

      return {
        x: event.clientX,
        y: event.clientY
      };
    }

    function startInteraction(
      event,
      interactionMode
    ) {

      mode = interactionMode;

      const point =
        getPoint(event);

      start = {
        px: point.x,
        py: point.y,
        area: Object.assign(
          {},
          editorArea
        )
      };

      event.preventDefault();
      event.stopPropagation();

      window.addEventListener(
        "pointermove",
        moveInteraction
      );

      window.addEventListener(
        "pointerup",
        stopInteraction
      );
    }

    box.addEventListener(
      "pointerdown",
      event => {

        if (
          event.target === handle
        ) {
          return;
        }

        startInteraction(
          event,
          "move"
        );
      }
    );

    handle.addEventListener(
      "pointerdown",
      event => {

        startInteraction(
          event,
          "resize"
        );
      }
    );

    function moveInteraction(event) {

      if (!mode) return;

      const rect =
        wrap.getBoundingClientRect();

      const point =
        getPoint(event);

      const dxPct =
        ((point.x - start.px) /
          rect.width) *
        100;

      const dyPct =
        ((point.y - start.py) /
          rect.height) *
        100;

      if (mode === "move") {

        editorArea.xPct =
          start.area.xPct +
          dxPct;

        editorArea.yPct =
          start.area.yPct +
          dyPct;

      } else {

        editorArea.wPct =
          start.area.wPct +
          dxPct;

        if (
          editorShape === "circle"
        ) {
          enforceCircleAspect();
        } else {
          editorArea.hPct =
            start.area.hPct +
            dyPct;
        }
      }

      clampArea();
      syncNumFieldsFromArea();
      drawAreaBox();
    }

    function stopInteraction() {

      mode = null;

      window.removeEventListener(
        "pointermove",
        moveInteraction
      );

      window.removeEventListener(
        "pointerup",
        stopInteraction
      );
    }

  })();

  // ============================================================
  // SAMPLE PREVIEW
  // ============================================================

  function drawSampleSilhouette(
    width,
    height
  ) {

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const context =
      canvas.getContext("2d");

    const gradient =
      context.createLinearGradient(
        0,
        0,
        width,
        height
      );

    gradient.addColorStop(
      0,
      "#B8873E"
    );

    gradient.addColorStop(
      1,
      "#16233D"
    );

    context.fillStyle =
      gradient;

    context.fillRect(
      0,
      0,
      width,
      height
    );

    context.fillStyle =
      "rgba(255,255,255,0.85)";

    context.beginPath();

    context.arc(
      width / 2,
      height * 0.38,
      Math.min(width, height) * 0.18,
      0,
      Math.PI * 2
    );

    context.fill();

    context.beginPath();

    context.ellipse(
      width / 2,
      height * 0.86,
      Math.min(width, height) * 0.32,
      Math.min(width, height) * 0.28,
      0,
      Math.PI,
      0,
      true
    );

    context.fill();

    return canvas;
  }

  function buildTemplateFromEditor() {

    return {
      id: currentTemplate?.id || null,

      image_url:
        currentTemplate.image_url,

      width:
        editorImgNatural.w,

      height:
        editorImgNatural.h,

      area: {
        xPct: editorArea.xPct,
        yPct: editorArea.yPct,
        wPct: editorArea.wPct,
        hPct: editorArea.hPct
      },

      shape:
        editorShape,

      radiusPct:
        editorRadius,

      fit:
        editorFit,

      published:
        currentTemplate.published
    };
  }

  document
    .getElementById("btnPreviewSample")
    .addEventListener(
      "click",
      async () => {

        if (!currentTemplate) {
          return;
        }

        const template =
          buildTemplateFromEditor();

        const sample =
          drawSampleSilhouette(
            600,
            800
          );

        const sampleImage =
          await loadImage(
            sample.toDataURL(
              "image/png"
            )
          );

        const canvas =
          await compositeCard(
            template,
            sampleImage
          );

        const output =
          document.getElementById(
            "sampleCanvas"
          );

        output.width =
          canvas.width;

        output.height =
          canvas.height;

        output
          .getContext("2d")
          .drawImage(
            canvas,
            0,
            0
          );

        document.getElementById(
          "samplePreviewFrame"
        ).style.display =
          "block";
      }
    );

  // ============================================================
  // SAVE / PUBLISH
  // ============================================================

  document
    .getElementById("btnPublish")
    .addEventListener(
      "click",
      async () => {

        if (
          !currentTemplate ||
          !currentTemplate.image_url
        ) {

          document.getElementById(
            "adminSaveMsg"
          ).textContent =
            "Please upload a design first.";

          return;
        }

        const template =
          buildTemplateFromEditor();

        template.published = true;

        try {

          let result;

          if (template.id) {

            result =
              await supabaseClient
                .from("templates")
                .update({
                  image_url:
                    template.image_url,

                  width:
                    template.width,

                  height:
                    template.height,

                  area:
                    template.area,

                  shape:
                    template.shape,

                  radius_pct:
                    template.radiusPct,

                  fit:
                    template.fit,

                  published:
                    true,

                  updated_at:
                    new Date().toISOString()
                })
                .eq(
                  "id",
                  template.id
                );

          } else {

            result =
              await supabaseClient
                .from("templates")
                .insert({
                  image_url:
                    template.image_url,

                  width:
                    template.width,

                  height:
                    template.height,

                  area:
                    template.area,

                  shape:
                    template.shape,

                  radius_pct:
                    template.radiusPct,

                  fit:
                    template.fit,

                  published:
                    true,

                  updated_at:
                    new Date().toISOString()
                });
          }

          if (result.error) {
            throw result.error;
          }

          document.getElementById(
            "adminSaveMsg"
          ).textContent =
            "Saved and published. The public generator is now live.";

          await loadTemplateIntoEditor();

        } catch (error) {

          console.error(error);

          document.getElementById(
            "adminSaveMsg"
          ).textContent =
            "Could not publish: " +
            error.message;
        }
      }
    );

  // ============================================================
  // UNPUBLISH
  // ============================================================

  document
    .getElementById("btnUnpublish")
    .addEventListener(
      "click",
      async () => {

        if (!currentTemplate?.id) {
          return;
        }

        const {
          error
        } = await supabaseClient
          .from("templates")
          .update({
            published: false,
            updated_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            currentTemplate.id
          );

        if (error) {

          document.getElementById(
            "adminSaveMsg"
          ).textContent =
            error.message;

          return;
        }

        document.getElementById(
          "adminSaveMsg"
        ).textContent =
          "Template unpublished. Public visitors will see Coming soon.";

        await loadTemplateIntoEditor();
      }
    );

  // ============================================================
  // DELETE
  // ============================================================

  document
    .getElementById("btnDeleteTemplate")
    .addEventListener(
      "click",
      async () => {

        if (!currentTemplate?.id) {
          return;
        }

        const confirmed =
          confirm(
            "Delete the current pledge-card template?"
          );

        if (!confirmed) {
          return;
        }

        const {
          error
        } = await supabaseClient
          .from("templates")
          .delete()
          .eq(
            "id",
            currentTemplate.id
          );

        if (error) {

          document.getElementById(
            "adminSaveMsg"
          ).textContent =
            error.message;

          return;
        }

        currentTemplate = null;

        document.getElementById(
          "adminSaveMsg"
        ).textContent =
          "Template deleted.";

        await loadTemplateIntoEditor();
      }
    );

  // ============================================================
  // ROUTING
  // ============================================================

  function render() {

    const publicView =
      document.getElementById(
        "publicView"
      );

    const adminView =
      document.getElementById(
        "adminView"
      );

    if (isAdminRoute()) {

      publicView.style.display =
        "none";

      adminView.style.display =
        "block";

      renderAdmin();

    } else {

      publicView.style.display =
        "block";

      adminView.style.display =
        "none";

      renderPublic();
    }
  }

  window.addEventListener(
    "hashchange",
    render
  );

  render();

})();