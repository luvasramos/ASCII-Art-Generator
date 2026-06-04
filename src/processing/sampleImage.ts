export const createDemoImageDataUrl = () => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return "";
    }

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#050608");
    gradient.addColorStop(0.36, "#21252d");
    gradient.addColorStop(0.72, "#d9d1be");
    gradient.addColorStop(1, "#f2efe5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = "multiply";
    const vignette = ctx.createRadialGradient(760, 430, 120, 760, 430, 780);
    vignette.addColorStop(0, "rgba(255,255,255,0.92)");
    vignette.addColorStop(0.62, "rgba(90,90,90,0.5)");
    vignette.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(4, 5, 7, 0.92)";
    ctx.beginPath();
    ctx.ellipse(710, 438, 168, 232, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(585, 618);
    ctx.bezierCurveTo(465, 684, 388, 807, 330, 1010);
    ctx.lineTo(1030, 1010);
    ctx.bezierCurveTo(982, 810, 902, 684, 792, 615);
    ctx.bezierCurveTo(730, 650, 652, 650, 585, 618);
    ctx.fill();

    ctx.fillStyle = "rgba(222, 216, 197, 0.76)";
    ctx.beginPath();
    ctx.moveTo(778, 346);
    ctx.bezierCurveTo(846, 394, 838, 524, 760, 598);
    ctx.bezierCurveTo(828, 560, 886, 465, 854, 365);
    ctx.bezierCurveTo(839, 319, 807, 286, 760, 268);
    ctx.fill();

    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "#f4f1e8";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(355, 700);
    ctx.bezierCurveTo(470, 624, 508, 516, 568, 396);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(855, 266);
    ctx.bezierCurveTo(1020, 334, 1096, 462, 1165, 616);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (let i = 0; i < 110; i += 1) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const size = 1 + Math.random() * 4;
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.1})`;
      ctx.fillRect(x, y, size, size);
    }

    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
};
