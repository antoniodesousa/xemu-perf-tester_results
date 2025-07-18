import { augmentMinMax, processData } from "./data.js";

const kPalette = [
  "#0C7BDC",
  "#E66100",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#9A6324",
  "#882255",
  "#F0E442",
  "#469990",
  "#D55E00",
];

const kTooltipConfig = {
  align: "left",
  font: {
    family: "Courier New, monospace",
    size: 14,
  },
};

const kCommonXAxisConfig = {
  automargin: true,
  tickangle: -25,
  categoryorder: "category ascending",
  zeroline: false,
};

const kCommonYAxisConfig = {
  zeroline: false,
};

const kPlotConfig = { responsive: true };

const kMinMaxMarkerSize = 18;
const kMinMaxMarkerBorderSize = 3;
const kDefaultMarkerSize = 12;
const kCommonMarkerConfig = {};

const kSearchableDataFields = [
  "cpu_manufacturer",
  "gpu_renderer",
  "gpu_vendor",
  "os_system",
  "renderer",
  "xemu_short_version",
  "machine_id",
  "trend",
];

const kDataSlices = {
  "by-cpu": { field: "cpu_manufacturer", title: "CPU" },
  "by-gpu": { field: "gpu_renderer", title: "GPU" },
  "by-gpu-vendor": { field: "gpu_vendor", title: "GPU Vendor" },
  "by-os": { field: "os_system", title: "Operating System" },
  "by-renderer": { field: "renderer", title: "Renderer Backend" },
  "by-version": { field: "xemu_version_obj", title: "xemu Version" },
};

const kDefaultSlicingScheme = "by-version";

const kDebounceTimeoutMilliseconds = 100;

const kMatchingDataItemsPadding = 20;

const kMaxJitter = 0.4;

const kDefaultVersionsDisplayed = 30;

const kMachineContinuityLineStyle = {
  color: "rgba(60, 20, 60, 0.7)",
  width: 2,
};

function styleTitle(titleString) {
  return {
    text: titleString,
    font: {
      family: "Arial",
      size: 22,
    },
    x: 0.5,
    xanchor: "center",
  };
}

function loadDataFilters(positiveFilterArray, negativeFilterArray) {
  const chipElements = document.querySelectorAll(
    "#data-filter-chip-area .chip",
  );

  chipElements.forEach((chip) => {
    const filterValue = chip.dataset.filterValue.toLowerCase();
    if (filterValue.startsWith("!")) {
      negativeFilterArray.push(filterValue.substring(1));
    } else {
      positiveFilterArray.push(filterValue);
    }
  });
}

function applyDataFilters(
  loadedData,
  filterText,
  positiveFilters,
  negativeFilters,
) {
  if (
    !loadedData ||
    !(filterText || positiveFilters.length > 0 || negativeFilters.length > 0)
  ) {
    return loadedData;
  }

  return loadedData.filter((d) => {
    const searchableString = kSearchableDataFields
      .map((key) => d[key])
      .join(" ")
      .toLowerCase();

    if (filterText) {
      if (filterText.startsWith("!")) {
        if (
          filterText.length > 1 &&
          searchableString.includes(filterText.substring(1))
        ) {
          return false;
        }
      } else if (!searchableString.includes(filterText)) {
        return false;
      }
    }

    const hasAllPositive = positiveFilters.every((term) =>
      searchableString.includes(term),
    );
    const hasAnyNegative = negativeFilters.some((term) =>
      searchableString.includes(term),
    );

    return hasAllPositive && !hasAnyNegative;
  });
}

function createDataFilterChip(text, onRemove) {
  const chipArea = document.getElementById("data-filter-chip-area");

  const chip = document.createElement("div");
  chip.className = "chip";
  chip.dataset.filterValue = text;
  if (text.startsWith("!")) {
    chip.classList.add("chip-negated");
    text = text.substring(1);
  }

  const chipText = document.createElement("span");
  chipText.textContent = text;

  const closeBtn = document.createElement("span");
  closeBtn.className = "chip-close-btn";
  closeBtn.innerHTML = "&times;";

  closeBtn.addEventListener("click", () => {
    chip.remove();
    onRemove();
  });

  chip.appendChild(chipText);
  chip.appendChild(closeBtn);

  chipArea.appendChild(chip);
}

function onPointClick(chart, points, scheme, testData) {
  if (!points.length) {
    return;
  }

  const clickedPoint = points[0];
  const machine_id_with_renderer = clickedPoint.customdata[6];

  if (!machine_id_with_renderer) {
    return;
  }

  const machineData = testData
    .filter((d) => d.machine_id_with_renderer === machine_id_with_renderer)
    .sort((a, b) => a[scheme.field].localeCompare(b[scheme.field]));

  const lineTrace = {
    type: "scatter",
    mode: "lines",
    x: machineData.map((d) => d.jitteredX),
    y: machineData.map((d) => d.average_ms),
    line: kMachineContinuityLineStyle,
    hoverinfo: "none",
    showlegend: false,
    name: "connection_line",
  };

  const tracesToRemove = [];
  chart.data.forEach((trace, index) => {
    if (trace.name === "connection_line") {
      tracesToRemove.push(index);
    }
  });

  if (tracesToRemove.length > 0) {
    Plotly.deleteTraces(chart, tracesToRemove);
  }

  Plotly.addTraces(chart, lineTrace);
}

/** Manually matches the number of X coordinate labels to zoom range. */
function updateVisibleTicks(chartDiv) {
  if (chartDiv.isUpdatingTicks) {
    return;
  }
  chartDiv.isUpdatingTicks = true;

  const fullTickvals = chartDiv.fullTickvals;
  const fullTicktext = chartDiv.fullTicktext;

  if (!fullTickvals || fullTickvals.length < 2) {
    return;
  }

  const xRange = chartDiv.layout.xaxis.range;
  const visibleTickCount = xRange[1] - xRange[0];

  const kPixelsPerXLabel = 40;
  const axisWidth = chartDiv._fullLayout.xaxis._length;
  const maxLabels = Math.floor(axisWidth / kPixelsPerXLabel);

  const newTickvals = [];
  const newTicktext = [];

  if (visibleTickCount > maxLabels) {
    const step = Math.ceil(visibleTickCount / maxLabels);
    for (let i = 0; i < fullTickvals.length; i++) {
      if (i % step === 0) {
        newTickvals.push(fullTickvals[i]);
        newTicktext.push(fullTicktext[i]);
      }
    }
  } else {
    for (let i = 0; i < fullTickvals.length; i++) {
      if (fullTickvals[i] >= xRange[0] && fullTickvals[i] <= xRange[1]) {
        newTickvals.push(fullTickvals[i]);
        newTicktext.push(fullTicktext[i]);
      }
    }
  }

  Plotly.relayout(chartDiv, {
    "xaxis.tickvals": newTickvals,
    "xaxis.ticktext": newTicktext,
  }).then(() => {
    chartDiv.isUpdatingTicks = false;
  });
}

function addChartContainer(name, chartsContainer) {
  const chartContainerDiv = document.createElement("div");
  chartContainerDiv.className = "chart-container";

  const chartDiv = document.createElement("div");
  chartDiv.className = "chart-div";
  chartDiv.dataset.testName = name;

  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";
  chartDiv.appendChild(spinner);

  chartContainerDiv.appendChild(chartDiv);
  chartsContainer.appendChild(chartContainerDiv);

  return chartDiv;
}

function buildCustomData(machineData) {
  return machineData.map((d) => [
    d.xemu_version,
    d.os_system,
    d.cpu_manufacturer,
    d.gpu_renderer,
    d.renderer,
    d.machine_id,
    d.machine_id_with_renderer,
    d.iso,
    d.cpu_freq_max,
    Number.isNaN(d.adjusted_min_ms) ? "??" : d.adjusted_min_ms,
    Number.isNaN(d.adjusted_max_ms) ? "No range data" : d.adjusted_max_ms,
    d.xemu_version.startsWith("xemu-0.0.0-") && d.xemu_tag
      ? `<br>  Tag: ${d.xemu_tag}`
      : "",
  ]);
}

function buildHoverTemplate() {
  return (
    "<b>%{y:.2f} ms</b><br>" +
    "Xemu    %{customdata[0]}%{customdata[11]}<br>" +
    "OS      %{customdata[1]}<br>" +
    "CPU     %{customdata[2]} [%{customdata[8]}]<br>" +
    "GPU     %{customdata[3]}<br>" +
    "Backend %{customdata[4]}<br>" +
    "%{customdata[9]} - %{customdata[10]}<br>" +
    "%{customdata[7]}<br>" +
    "%{customdata[5]}<br>" +
    "<extra></extra>"
  );
}

function symbolForRendererBackend(renderer_backend) {
  if (renderer_backend === "GL") {
    return "circle";
  }

  if (renderer_backend === "VK") {
    return "star";
  }

  return "x";
}

function buildTrace(data, name, color) {
  return {
    type: "scatter",
    mode: "markers",
    name: name,
    marker: {
      ...kCommonMarkerConfig,
      symbol: data.map((d) => symbolForRendererBackend(d.renderer)),
      color: color,
      size: data.map((d) =>
        d.isMin || d.isMax ? kMinMaxMarkerSize : kDefaultMarkerSize,
      ),
      line: {
        color: data.map((d) => {
          if (d.isMin) return "green";
          if (d.isMax) return "red";
          return "rgba(0,0,0,0)";
        }),
        width: data.map((d) =>
          d.isMin || d.isMax ? kMinMaxMarkerBorderSize : 0,
        ),
      },
    },
    x: data.map((d) => d.jitteredX),
    y: data.map((d) => d.average_ms),
    customdata: buildCustomData(data),
    hovertemplate: buildHoverTemplate(),
  };
}

function buildErrorBars(data, name, color) {
  return {
    type: "scatter",
    mode: "none",
    name: name,
    x: data.map((d) => d.jitteredX),
    y: data.map((d) => d.average_ms),
    opacity: 0.5,
    error_y: {
      type: "data",
      symmetric: false,
      array: data.map((d) => d.error_plus_ms),
      arrayminus: data.map((d) => d.error_minus_ms),
      color: color,
    },
  };
}

function highlightMatch(fullText, filterText) {
  if (!filterText) {
    return fullText;
  }
  const regex = new RegExp(filterText, "gi");

  const result = [];
  let lastIndex = 0;

  while (true) {
    const match = regex.exec(fullText);
    if (match === null) {
      break;
    }

    if (match.index > lastIndex) {
      result.push(
        `<span class="data-filter-suggestion-non-matching-text">${fullText.substring(lastIndex, match.index)}</span>`,
      );
    }
    result.push(
      `<span class="data-filter-suggestion-matching-text"><u><b>${match[0]}</b></u></span>`,
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < fullText.length) {
    result.push(
      `<span class="data-filter-suggestion-non-matching-text">${fullText.substring(lastIndex)}</span>`,
    );
  }

  return result.join("");
}

function filteredTestsByName(processedData, filterText) {
  const testsByName = processedData.reduce((acc, d) => {
    const arr = acc[d.test_name] || [];
    arr.push(d);
    acc[d.test_name] = arr;
    return acc;
  }, {});

  if (!filterText) {
    return testsByName;
  }

  const filteredTests = {};
  for (const testName in testsByName) {
    if (testName.toLowerCase().includes(filterText)) {
      filteredTests[testName] = testsByName[testName];
    }
  }
  return filteredTests;
}

function getAllVersions(allData) {
  const versionMap = new Map();
  allData.forEach((d) => {
    versionMap.set(d.xemu_version_obj.compare_name, d.xemu_version_obj);
  });

  return Array.from(versionMap.values()).sort((a, b) => a.localeCompare(b));
}

function tomSelectScrollToCurrentValue() {
  const selectedValue = this.getValue();

  if (selectedValue) {
    const selectedOption = this.getOption(selectedValue);
    if (selectedOption) {
      requestAnimationFrame(() =>
        selectedOption.scrollIntoView({
          block: "center",
          behavior: "instant",
        }),
      );
    }
  }
}

function getTestDescriptor(fullyQualifiedTestName, testSuiteDescriptors) {
  if (!testSuiteDescriptors) {
    return {};
  }

  const components = fullyQualifiedTestName.split("::");
  const testSuite = components[0];
  const testName = components[1];

  let descriptor = testSuiteDescriptors[testSuite];
  if (!descriptor) {
    // Descriptor keys are generally of the form TestSuiteTests whereas the suite
    // names tend to be "Test_suite" or "Test suite".
    const camelCased = testSuite
      .split(/[_\s]/)
      .map((element) => element.charAt(0).toUpperCase() + element.slice(1))
      .join("");

    descriptor = testSuiteDescriptors[camelCased];
    if (!descriptor) {
      descriptor = testSuiteDescriptors[`${camelCased}Tests`];
    }
  }

  if (!descriptor) {
    return {};
  }

  return {
    suiteDescription: descriptor.description,
    suiteSourceURL: descriptor.source_file,
    testDescription: descriptor.tests[testName],
  };
}

export function initializeApp(loadedData, testSuiteDescriptors) {
  let debounceTimer;
  const pendingCharts = new Map();

  const chartsContainer = document.getElementById("charts-container");

  const outlierCheckbox = document.getElementById("outlier-checkbox");
  const showErrorBarsCheckbox = document.getElementById("error-bars-checkbox");
  const highlightMinMaxCheckbox = document.getElementById(
    "highlight-minmax-checkbox",
  );

  const fullscreenOverlay = document.getElementById("fullscreen-overlay");
  const fullscreenChartDiv = document.getElementById("fullscreen-chart");
  const closeFullscreenBtn = document.getElementById("close-fullscreen");

  closeFullscreenBtn.addEventListener("click", () => {
    fullscreenOverlay.style.display = "none";
    Plotly.purge(fullscreenChartDiv);
  });

  const testFilterInput = document.getElementById("test-filter");
  const dataFilterInput = document.getElementById("data-filter");

  const suggestionsOverlay = document.getElementById("data-filter-suggestions");

  const allVersions = getAllVersions(loadedData);

  const versionOptions = allVersions.map((version, index) => ({
    value: index,
    text: version.toString(),
  }));

  const tomSelectSettings = {
    options: versionOptions,
    create: false,
    sortField: { field: "value", direction: "asc" },
    maxOptions: null,
    onDropdownOpen: tomSelectScrollToCurrentValue,
  };

  const startSelect = new TomSelect(
    document.getElementById("start-version-select"),
    tomSelectSettings,
  );
  const endSelect = new TomSelect(
    document.getElementById("end-version-select"),
    tomSelectSettings,
  );

  startSelect.on("change", (startValue) => {
    const startIndex = parseInt(startValue, 10);
    if (Number.isNaN(startIndex)) return;

    const validEndOptions = versionOptions.slice(startIndex);
    endSelect.clearOptions();
    endSelect.addOption(validEndOptions);

    const currentEndIndex = parseInt(endSelect.getValue(), 10);
    if (Number.isNaN(currentEndIndex) || currentEndIndex < startIndex) {
      endSelect.setValue(startIndex);
    }

    handleFilterChange();
  });

  endSelect.on("change", handleFilterChange);

  const sliceOptions = Object.entries(kDataSlices).map(([key, value]) => ({
    value: key,
    text: value.title,
  }));

  const viewModeSelector = new TomSelect(
    document.getElementById("slice-selector"),
    {
      options: sliceOptions,
      create: false,
      onDropdownOpen: tomSelectScrollToCurrentValue,
    },
  );

  viewModeSelector.on("change", handleFilterChange);
  viewModeSelector.setValue(kDefaultSlicingScheme, true);

  function buildChartButtons() {
    const buttonsContainer = document.createElement("div");
    buttonsContainer.className = "chart-buttons-container";

    const expandButton = document.createElement("button");
    expandButton.textContent = "Expand";
    expandButton.className = "expand-button";
    buttonsContainer.appendChild(expandButton);

    const shareButton = document.createElement("button");
    shareButton.textContent = "Share";
    shareButton.className = "share-button";
    buttonsContainer.appendChild(shareButton);

    const infoButton = document.createElement("button");
    infoButton.textContent = "Info";
    infoButton.className = "info-button";
    infoButton.classList.add("has-tooltip");
    infoButton.dataset.hoverText = "View source";
    buttonsContainer.appendChild(infoButton);

    return { buttonsContainer, expandButton, shareButton, infoButton };
  }

  /** Adds additional elements to a chart container (e.g., expand/share buttons). */
  function augmentChart(chartDiv, chartData) {
    const {
      layout,
      traces,
      testName,
      onPointClickArgs,
      dynamicTicks,
      testDescriptor,
    } = chartData;

    const { buttonsContainer, expandButton, shareButton, infoButton } =
      buildChartButtons();

    expandButton.addEventListener("click", () => {
      const fullscreenLayout = JSON.parse(JSON.stringify(layout));
      if (fullscreenLayout.title) {
        fullscreenLayout.title.font = { size: 24 };
      }
      fullscreenOverlay.style.display = "block";
      Plotly.newPlot(fullscreenChartDiv, traces, fullscreenLayout, {
        responsive: true,
      });
    });

    shareButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const params = captureState(testName);
      const shareableUrl = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
      navigator.clipboard.writeText(shareableUrl).then(() => {
        shareButton.textContent = "Copied!";
        shareButton.classList.add("copied");
        setTimeout(() => {
          shareButton.textContent = "Share";
          shareButton.classList.remove("copied");
        }, 2000);
      });
    });

    if (!testDescriptor) {
      infoButton.style.display = "none";
    } else {
      infoButton.dataset.tooltip = `${testDescriptor.testDescription}`;

      infoButton.addEventListener("mouseenter", () => {
        infoButton.textContent = "Source";
      });
      infoButton.addEventListener("mouseleave", () => {
        infoButton.textContent = "Info";
      });

      infoButton.addEventListener("click", () => {
        window.open(testDescriptor.suiteSourceURL, "_blank");
      });
    }

    chartDiv.parentElement.appendChild(buttonsContainer);

    if (onPointClickArgs) {
      chartDiv.on("plotly_click", (eventData) => {
        onPointClick(
          chartDiv,
          eventData.points,
          onPointClickArgs.scheme,
          onPointClickArgs.data,
        );
      });
    }

    if (dynamicTicks) {
      updateVisibleTicks(chartDiv);

      chartDiv.on("plotly_relayout", (eventData) => {
        const isZoomOrPan =
          eventData["xaxis.range[0]"] !== undefined ||
          eventData["xaxis.autorange"] === true;
        if (isZoomOrPan) {
          setTimeout(() => updateVisibleTicks(chartDiv), 20);
        }
      });
    }
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const chartDiv = entry.target;
          const chartData = pendingCharts.get(chartDiv);

          if (chartData) {
            Plotly.newPlot(
              chartDiv,
              chartData.traces,
              chartData.layout,
              kPlotConfig,
            ).then(() => {
              const spinner = chartDiv.querySelector(".loading-spinner");
              if (spinner) {
                spinner.remove();
              }
              augmentChart(chartDiv, chartData);
            });

            pendingCharts.delete(chartDiv);
            obs.unobserve(chartDiv);
          }
        }
      });
    },
    { rootMargin: "500px" },
  );

  function captureState(anchorTestName) {
    const params = new URLSearchParams();

    params.set("view", viewModeSelector.getValue());

    const outlier = outlierCheckbox.checked;
    if (outlier) {
      params.set("outlier", outlier);
    }

    const showErrorBars = showErrorBarsCheckbox.checked;
    if (showErrorBars) {
      params.set("showErrorBars", showErrorBars);
    }

    const highlight = highlightMinMaxCheckbox.checked;
    if (highlight) {
      params.set("hmm", "true");
    }

    const testFilter = testFilterInput.value;
    if (testFilter) {
      params.set("testFilter", testFilter);
    }

    const dataFilter = dataFilterInput.value;
    if (dataFilter) {
      params.set("dataFilter", dataFilter);
    }

    const chipElements = document.querySelectorAll(
      "#data-filter-chip-area .chip",
    );
    chipElements.forEach((chip) => {
      params.append("df", chip.dataset.filterValue);
    });

    params.set("rangeStart", startSelect.getValue());
    params.set("rangeEnd", endSelect.getValue());

    if (anchorTestName) {
      params.set("anchor", anchorTestName);
    }

    return params;
  }

  function updateURLFromState(anchorTestName) {
    const params = captureState(anchorTestName);
    const newHash = params.toString();
    if (history.replaceState) {
      history.replaceState(
        null,
        "",
        newHash
          ? `#${newHash}`
          : window.location.pathname + window.location.search,
      );
    } else {
      window.location.hash = newHash;
    }
  }

  function applyStateFromURL() {
    if (!window.location.hash) {
      return null;
    }

    const params = new URLSearchParams(window.location.hash.substring(1));

    const view = params.get("view");
    if (view && kDataSlices[view]) {
      viewModeSelector.setValue(view, true);
    } else {
      viewModeSelector.setValue(kDefaultSlicingScheme);
    }

    const outlier = params.get("outlier");
    if (outlier) {
      outlierCheckbox.checked = outlier === "true";
    }

    const showErrorBars = params.get("showErrorBars");
    if (showErrorBars) {
      showErrorBarsCheckbox.checked = showErrorBars === "true";
    }

    const highlight = params.get("hmm");
    if (highlight) {
      highlightMinMaxCheckbox.checked = highlight === "true";
    }

    const testFilter = params.get("testFilter");
    if (testFilter) {
      testFilterInput.value = testFilter;
    }

    const dataFilter = params.get("dataFilter");
    if (dataFilter) {
      dataFilterInput.value = dataFilter;
    }

    const chips = params.getAll("df");
    if (chips.length > 0) {
      chips.forEach((chipText) =>
        createDataFilterChip(chipText, handleFilterChange),
      );
    }

    const start = params.get("rangeStart");
    const end = params.get("rangeEnd");
    if (start && end) {
      startSelect.setValue(start, true);
      endSelect.setValue(end, true);
    }

    return params.get("anchor");
  }

  function styleSummaries(summaryData) {
    const ret = {
      colors: [],
      lineColors: [],
      lineWidths: [],
    };

    summaryData.forEach((d) => {
      const uniqueMachineCount = d.uniqueMachineCount;

      let color;
      let lineColor;
      let lineWidth;

      if (uniqueMachineCount < 4) {
        color = "rgba(0, 0, 0, 0.1)";
        lineColor = "rgba(211, 47, 47, 0.8)";
        lineWidth = 0;
      } else if (uniqueMachineCount < 10) {
        color = "rgb(200, 200, 40)";
        lineColor = color;
        lineWidth = 0;
      } else {
        color = "rgb(52, 152, 219)";
        lineColor = color;
        lineWidth = 0;
      }

      ret.colors.push(color);
      ret.lineColors.push(lineColor);
      ret.lineWidths.push(lineWidth);
    });

    return ret;
  }

  function renderSummaryChart(scheme, processedData) {
    if (!scheme) {
      throw Error("renderSummaryChart called with invalid scheme");
    }

    const summaryChartDiv = addChartContainer("summary-chart", chartsContainer);

    const means = {};
    for (const d of processedData) {
      const category = d[scheme.field];
      if (!means[category]) {
        means[category] = {
          total_us: 0,
          count: 0,
          machine_ids: new Set(),
        };
      }
      means[category].total_us += d.average_us;
      ++means[category].count;
      means[category].machine_ids.add(d.machine_id);
    }

    const summaryData = Object.entries(means).map(([category, totals]) => {
      return {
        category: category,
        score: totals.total_us / totals.count / 1000.0,
        points: totals.count,
        uniqueMachineCount: totals.machine_ids.size,
      };
    });

    const summaryStyles = styleSummaries(summaryData);
    const trace = {
      type: "bar",
      marker: {
        color: summaryStyles.colors,
        line: {
          color: summaryStyles.lineColors,
          width: summaryStyles.lineWidths,
          dash: "dot",
        },
      },
      x: summaryData.map((d) => d.category),
      y: summaryData.map((d) => d.score),
      customdata: summaryData.map((d) => [d.points, d.uniqueMachineCount]),
      hovertemplate:
        "<b>%{y:.2f}</b><br>" +
        "Num data points: %{customdata[0]}<br>" +
        "Unique machines: %{customdata[1]}" +
        "<extra></extra>",
    };

    const layout = {
      title: styleTitle("Overall average duration (lower is better)"),
      xaxis: {
        ...kCommonXAxisConfig,
        title: scheme.title,
      },
      yaxis: { ...kCommonYAxisConfig, title: "Sum of averages" },
      hoverlabel: kTooltipConfig,
    };

    pendingCharts.set(summaryChartDiv, {
      traces: [trace],
      layout: layout,
      testName: "summary-chart",
    });
    observer.observe(summaryChartDiv);
  }

  function renderTestResultCharts(
    selectedSchemeKey,
    scheme,
    processedData,
    filterText,
    showErrorBars,
    highlightMinMax,
  ) {
    const testsByName = filteredTestsByName(processedData, filterText);

    for (const testName in testsByName) {
      const testData = testsByName[testName];

      const xCategories = [
        ...new Set(testData.map((d) => d[scheme.field])),
      ].sort((a, b) => a.localeCompare(b));

      const categoryMap = new Map(xCategories.map((cat, i) => [cat, i]));

      if (highlightMinMax) {
        augmentMinMax(testData);
      }

      const pointsPerCategory = {};
      testData.forEach((d) => {
        const category = d[scheme.field];
        pointsPerCategory[category] = (pointsPerCategory[category] || 0) + 1;
      });

      const categoryIndexCounter = {};
      testData.forEach((d) => {
        const category = d[scheme.field];
        const numPoints = pointsPerCategory[category];
        const currentIndex = categoryIndexCounter[category] || 0;

        const basePosition = categoryMap.get(category);
        let offset = 0;
        if (numPoints > 1) {
          offset = currentIndex / (numPoints - 1) - 0.5;
        }

        d.jitteredX = basePosition + offset * kMaxJitter;

        categoryIndexCounter[category] = currentIndex + 1;
      });

      const traces = [];
      if (selectedSchemeKey === "by-version") {
        const machines = testData.reduce((acc, d) => {
          const arr = acc[d.machine_id] || [];
          arr.push(d);
          acc[d.machine_id] = arr;
          return acc;
        }, {});

        Object.entries(machines).forEach(([machineId, machineData], index) => {
          const color = kPalette[index % kPalette.length];
          if (showErrorBars) {
            traces.push(buildErrorBars(machineData, machineId, color));
          }
          traces.push(buildTrace(machineData, machineId, color));
        });
      } else {
        const versions = testData.reduce((acc, d) => {
          const arr = acc[d.xemu_version_obj] || [];
          arr.push(d);
          acc[d.xemu_version_obj.short_name] = arr;
          return acc;
        }, {});

        Object.entries(versions).forEach(
          ([version_short_name, versionData], index) => {
            const color = kPalette[index % kPalette.length];
            if (showErrorBars) {
              traces.push(
                buildErrorBars(versionData, version_short_name, color),
              );
            }
            traces.push(buildTrace(versionData, version_short_name, color));
          },
        );
      }

      const layout = {
        title: styleTitle(`${testName} by ${scheme.title}`),
        xaxis: {
          ...kCommonXAxisConfig,
          title: scheme.title,
          tickvals: [],
          ticktext: [],
          dtick: 1,
        },
        yaxis: {
          ...kCommonYAxisConfig,
          title: "Avg duration (ms)",
          autorange: true,
        },
        showlegend: selectedSchemeKey !== "by-version",
        hoverlabel: kTooltipConfig,
      };

      const chartDiv = addChartContainer(testName, chartsContainer);
      chartDiv.fullTickvals = Array.from(categoryMap.values());
      chartDiv.fullTicktext = Array.from(categoryMap.keys());

      pendingCharts.set(chartDiv, {
        traces,
        layout,
        testName,
        onPointClickArgs: {
          scheme: scheme,
          data: testData,
          categoryMap: categoryMap,
        },
        dynamicTicks: true,
        testDescriptor: getTestDescriptor(testName, testSuiteDescriptors),
      });
      observer.observe(chartDiv);
    }
  }

  function renderAllCharts() {
    const excludeOutliers = outlierCheckbox.checked;
    const showErrorBars = showErrorBarsCheckbox.checked;
    const highlightMinMax = highlightMinMaxCheckbox.checked;

    const selectedSchemeKey = viewModeSelector.getValue();
    const scheme = kDataSlices[selectedSchemeKey];
    const testFilterText = testFilterInput.value.toLowerCase().trim();
    const dataFilterText = dataFilterInput.value.toLowerCase().trim();

    const positiveFilters = [];
    const negativeFilters = [];
    loadDataFilters(positiveFilters, negativeFilters);

    localStorage.setItem("xemuPerfChartMode", selectedSchemeKey);
    localStorage.setItem("xemuPerfExcludeOutlier", excludeOutliers);

    chartsContainer.innerHTML = "";

    const startIdx = parseInt(startSelect.getValue(), 10);
    const endIdx = parseInt(endSelect.getValue(), 10);

    const startVersion =
      allVersions[
        Number.isNaN(startIdx)
          ? Math.max(allVersions.length - 1 - kDefaultVersionsDisplayed, 0)
          : startIdx
      ];
    const endVersion =
      allVersions[Number.isNaN(endIdx) ? allVersions.length - 1 : endIdx];

    const versionFilteredData = loadedData.filter((d) => {
      const versionObj = d.xemu_version_obj;
      return (
        versionObj.localeCompare(startVersion) >= 0 &&
        versionObj.localeCompare(endVersion) <= 0
      );
    });

    const filteredRawData = applyDataFilters(
      versionFilteredData,
      dataFilterText,
      positiveFilters,
      negativeFilters,
    );
    if (!filteredRawData || filteredRawData.length === 0) {
      chartsContainer.innerHTML = "<p>No data available to display.</p>";
      return;
    }

    const processedData = processData(filteredRawData, excludeOutliers);

    if (
      !testFilterText &&
      !(
        dataFilterText ||
        positiveFilters.length > 0 ||
        negativeFilters.length > 0
      )
    ) {
      renderSummaryChart(scheme, processedData);
    }
    renderTestResultCharts(
      selectedSchemeKey,
      scheme,
      processedData,
      testFilterText,
      showErrorBars,
      highlightMinMax,
    );
  }

  function updateFilterSuggestions() {
    const rawText = dataFilterInput.value.toLowerCase().trim();
    const isNegated = rawText.startsWith("!");
    const filterText = (isNegated ? rawText.substring(1) : rawText)
      .toLowerCase()
      .trim();

    if (!filterText) {
      suggestionsOverlay.style.display = "none";
      return;
    }

    suggestionsOverlay.classList.toggle("negated", isNegated);

    const inputContainer = document.getElementById("data-filter-container");
    if (inputContainer) {
      const calculatedMaxWidth = window.innerWidth - kMatchingDataItemsPadding;
      suggestionsOverlay.style.maxWidth = `${calculatedMaxWidth}px`;
    }

    const matchCounts = {};
    const matchingMachines = new Set();
    loadedData.forEach((d) => {
      for (const field of kSearchableDataFields) {
        const value = d[field];
        if (value?.toLowerCase().includes(filterText)) {
          matchCounts[value] = (matchCounts[value] || new Set()).add(
            d.machine_id,
          );
          matchingMachines.add(d.machine_id);
        }
      }
    });

    if (Object.keys(matchCounts).length === 0) {
      suggestionsOverlay.style.display = "none";
      return;
    }

    let html = `<ul>`;
    const sortedMatches = Object.entries(matchCounts).sort();
    for (const [match, matches] of sortedMatches) {
      const highlightedMatch = highlightMatch(match, filterText);
      html += `<li>${highlightedMatch} (${matches.size})</li>`;
    }
    html += "</ul>";

    suggestionsOverlay.innerHTML = html;
    suggestionsOverlay.style.display = "block";
  }

  function handleFilterChange() {
    let anchorTestName = null;
    let previousTopOffset = null;
    const allCurrentCharts = Array.from(
      document.querySelectorAll(".chart-container"),
    );
    const orderedTestNames = allCurrentCharts.map((c) => c.dataset.testName);

    for (const chart of allCurrentCharts) {
      const topPos = chart.getBoundingClientRect().top;
      if (topPos >= 0) {
        anchorTestName = chart.dataset.testName;
        previousTopOffset = topPos;
        break;
      }
    }
    if (!anchorTestName && allCurrentCharts.length > 0) {
      anchorTestName =
        allCurrentCharts[allCurrentCharts.length - 1].dataset.testName;
    }

    updateURLFromState(anchorTestName);

    renderAllCharts();

    requestAnimationFrame(() => {
      let targetChart = document.querySelector(
        `[data-test-name="${anchorTestName}"]`,
      );
      if (!targetChart) {
        const originalIndex = orderedTestNames.indexOf(anchorTestName);
        for (let i = originalIndex - 1; i >= 0; i--) {
          const previousTestName = orderedTestNames[i];
          const previousChart = document.querySelector(
            `[data-test-name="${previousTestName}"]`,
          );
          if (previousChart) {
            targetChart = previousChart;
            break;
          }
        }
      }

      if (targetChart) {
        const elementPosition = targetChart.getBoundingClientRect().top;
        const targetPosition = elementPosition - previousTopOffset;

        window.scrollTo({ top: targetPosition });
      }
    });
  }

  function handleDebouncedChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleFilterChange();
    }, kDebounceTimeoutMilliseconds);
  }

  outlierCheckbox.addEventListener("change", handleFilterChange);
  showErrorBarsCheckbox.addEventListener("change", handleFilterChange);
  highlightMinMaxCheckbox.addEventListener("change", handleFilterChange);

  testFilterInput.addEventListener("input", handleDebouncedChange);

  dataFilterInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const text = dataFilterInput.value.trim();
      dataFilterInput.value = "";
      dataFilterInput.classList.remove("negated");
      suggestionsOverlay.style.display = "none";

      if (text && text !== "!") {
        createDataFilterChip(text, handleFilterChange);
        handleFilterChange();
      }
    }
  });
  dataFilterInput.addEventListener("input", () => {
    dataFilterInput.classList.toggle(
      "negated",
      dataFilterInput.value.startsWith("!"),
    );

    updateFilterSuggestions();
    handleDebouncedChange();
  });
  dataFilterInput.addEventListener("focus", updateFilterSuggestions);
  dataFilterInput.addEventListener("blur", () => {
    suggestionsOverlay.style.display = "none";
  });

  const initialAnchor = applyStateFromURL();

  function initializeVersionRange() {
    let currentEndIndex = parseInt(endSelect.getValue(), 10);
    if (
      Number.isNaN(currentEndIndex) ||
      currentEndIndex >= allVersions.length
    ) {
      currentEndIndex = allVersions.length - 1;
      endSelect.setValue(currentEndIndex, true);
    }

    if (Number.isNaN(parseInt(startSelect.getValue(), 10))) {
      const startIndex = currentEndIndex - kDefaultVersionsDisplayed;
      startSelect.setValue(startIndex, true);
      endSelect.clearOptions();
      endSelect.addOption(versionOptions.slice(startIndex));
    }
  }

  initializeVersionRange();

  renderAllCharts();

  if (initialAnchor) {
    setTimeout(() => {
      const targetChart = document.querySelector(
        `[data-test-name="${initialAnchor}"]`,
      );
      if (targetChart) {
        targetChart.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }, 100);
  }
}
