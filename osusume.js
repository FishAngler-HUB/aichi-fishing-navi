/* =========================================================
   osusume.js  -  今日のおすすめ釣り場 TOP5 ＋ 今の狙い目
   ---------------------------------------------------------
   ・既存の script.js には一切手を加えていません。
     このファイルはあとから読み込まれ、ホーム画面に
     「今日のおすすめ」ブロックを追加するだけです。
   ・読み込むデータ（すべて data/ フォルダ）:
       spots.json     … 釣り場と特徴（必須）
       fish.json      … 魚種の生態（必須）
       forecast.json  … 天気・海況（任意。無ければ季節・釣り場情報のみで判定）
       catches.json   … 最近の釣果メモ（任意。あれば「釣果実績」に反映）
       scoring.json   … 配点（任意。無ければ既定値 35/25/30/10）
       now_biting.json… 「今の狙い目」の手動上書き（任意）
   ・自分の釣果記録（localStorage "fishingCatches"）も釣果実績に合算します
     （その端末内のみ。他の訪問者には影響しません）
   ========================================================= */
(function () {
  "use strict";

  var SPOTS_URL = "data/spots.json";
  var FISH_URL = "data/fish.json";
  var FORECAST_URL = "data/forecast.json";
  var CATCHES_URL = "data/catches.json";
  var SCORING_URL = "data/scoring.json";
  var NOW_BITING_URL = "data/now_biting.json";

  // script.js と同じ並び（角度→8方位）
  var DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

  // 各評価項目の内部満点（scoring.json の weights はこれを基準に按分）
  var BASE_MAX = { catch: 35, season: 25, condition: 30, ease: 10 };
  var DEFAULT_SCORING = {
    weights: { catch: 35, season: 25, condition: 30, ease: 10 },
    recencyDecay: [
      { maxAgeDays: 1, factor: 1.0 },
      { maxAgeDays: 3, factor: 0.8 },
      { maxAgeDays: 7, factor: 0.55 },
      { maxAgeDays: 14, factor: 0.3 },
      { maxAgeDays: 30, factor: 0.12 },
    ],
    noCatchDataScore: 6,
  };

  var data = {
    spots: [],
    fish: {},
    forecast: null,
    catchesFile: null,
    catches: [], // spots.json / localStorage を合算した釣果プール
    scoring: DEFAULT_SCORING,
    nowBiting: null,
  };

  var nowBitingHasContent = false;

  /* ---------- 小さなユーティリティ ---------- */

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function degToDir(deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return null;
    return DIRS[Math.round(deg / 45) % 8];
  }

  function seasonOfMonth(month) {
    if (month >= 3 && month <= 5) return "春";
    if (month >= 6 && month <= 8) return "夏";
    if (month >= 9 && month <= 11) return "秋";
    return "冬";
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function uniq(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      if (!seen[x]) {
        seen[x] = true;
        out.push(x);
      }
    });
    return out;
  }

  function stars(score) {
    var n = Math.round(score / 20);
    n = clamp(n, 0, 5);
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }

  // "YYYY-MM-DD" → 今日から何日前か（ローカル日付ベース）
  function daysAgo(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((t0 - d) / 86400000);
  }

  function loadJson(url, optional) {
    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error(url + " -> " + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (optional) return null;
        throw err;
      });
  }

  /* ---------- 釣果プールの構築（catches.json ＋ 自分のlocalStorage） ---------- */

  function buildCatchPool() {
    var pool = [];

    if (data.catchesFile && Array.isArray(data.catchesFile.catches)) {
      data.catchesFile.catches.forEach(function (c) {
        if (!c || !c.date) return;
        pool.push({
          spotId: c.spotId != null ? c.spotId : null,
          location: c.location || "",
          species: c.species || "",
          date: c.date,
          count: c.count,
          source: c.source || "file",
        });
      });
    }

    try {
      var raw = localStorage.getItem("fishingCatches");
      if (raw) {
        var list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(function (c) {
            if (!c || !c.date || !c.species) return;
            pool.push({
              spotId: c.spotId || null,
              location: c.location || "",
              species: c.species,
              date: c.date,
              count: 1,
              source: "self-local",
            });
          });
        }
      }
    } catch (e) {
      /* localStorage 使用不可でも続行 */
    }

    data.catches = pool;
  }

  function catchMatchesSpot(c, spot) {
    if (c.spotId != null && String(c.spotId) === String(spot.id)) return true;
    if (c.location && spot.name && String(c.location).indexOf(spot.name) !== -1)
      return true;
    return false;
  }

  function speciesMatches(recordSpecies, fishName) {
    var sp = String(recordSpecies || "");
    if (!sp || !fishName) return false;
    return sp.indexOf(fishName) !== -1 || fishName.indexOf(sp) !== -1;
  }

  /* ---------- スコア計算 ---------- */

  function todayForecast(spotId) {
    if (!data.forecast || !data.forecast.spots) return null;
    var entry = data.forecast.spots[String(spotId)];
    if (!entry || !entry.days || entry.days.length === 0) return null;
    var todayStr = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
    for (var i = 0; i < entry.days.length; i++) {
      if (entry.days[i].date === todayStr) return entry.days[i];
    }
    return entry.days[0];
  }

  function isInSeason(fishData, month) {
    if (!fishData || !fishData.seasonMonths) return false;
    var sm = fishData.seasonMonths;
    return (
      (sm.best || []).indexOf(month) !== -1 ||
      (sm.ok || []).indexOf(month) !== -1
    );
  }

  function recencyFactor(age) {
    var decay = (data.scoring && data.scoring.recencyDecay) || DEFAULT_SCORING.recencyDecay;
    for (var i = 0; i < decay.length; i++) {
      if (age <= decay[i].maxAgeDays) return decay[i].factor;
    }
    return 0;
  }

  function weightOf(key) {
    var w = data.scoring && data.scoring.weights;
    if (w && typeof w[key] === "number") return w[key];
    return BASE_MAX[key];
  }

  // 釣果実績 0〜35（新しさ・件数・増減・鮮度）
  function catchAnalysis(spot, fishName) {
    var recs = [];
    data.catches.forEach(function (c) {
      if (!catchMatchesSpot(c, spot)) return;
      if (fishName && !speciesMatches(c.species, fishName)) return;
      var age = daysAgo(c.date);
      if (age === null || age < 0 || age > 30) return;
      recs.push({
        age: age,
        count: clamp(Number(c.count) || 1, 1, 10),
      });
    });

    var noScore =
      (data.scoring && typeof data.scoring.noCatchDataScore === "number"
        ? data.scoring.noCatchDataScore
        : DEFAULT_SCORING.noCatchDataScore);

    if (recs.length === 0) {
      return { points: noScore, noData: true, last7: 0, last30: 0, reason: null };
    }

    var W = 0,
      last7 = 0,
      last30 = 0,
      prev7 = 0,
      minAge = 999;
    recs.forEach(function (r) {
      W += (recencyFactor(r.age) * r.count) / 4;
      if (r.age <= 7) last7 += r.count;
      if (r.age <= 30) last30 += r.count;
      if (r.age >= 8 && r.age <= 14) prev7 += r.count;
      if (r.age < minAge) minAge = r.age;
    });

    var volPts = 20 * (1 - Math.exp(-W / 2.5));

    var trendPts, trendWord;
    if (last7 > 0 && prev7 > 0) {
      if (last7 >= prev7 * 1.3 && last7 >= 2) {
        trendPts = 8;
        trendWord = "増加傾向";
      } else if (last7 <= prev7 * 0.7) {
        trendPts = 1;
        trendWord = "減少傾向";
      } else {
        trendPts = 4;
        trendWord = "横ばい";
      }
    } else if (last7 > 0) {
      trendPts = 6;
      trendWord = "最近動きあり";
    } else {
      trendPts = 1;
      trendWord = "やや停滞";
    }

    var freshPts =
      minAge <= 1 ? 7 : minAge <= 3 ? 5 : minAge <= 7 ? 3 : minAge <= 14 ? 1 : 0;

    var points = clamp(volPts + trendPts + freshPts, 0, 35);

    var freshLabel =
      minAge <= 0 ? "今日" : minAge === 1 ? "昨日" : minAge + "日前";
    var label = fishName || "各魚種";
    var reason =
      last7 > 0
        ? "直近7日で" +
          label +
          "の釣果" +
          last7 +
          "件（" +
          trendWord +
          "・最終" +
          freshLabel +
          "）"
        : "直近30日で" +
          label +
          "の釣果" +
          last30 +
          "件（最終" +
          freshLabel +
          "）";

    return {
      points: points,
      noData: false,
      last7: last7,
      last30: last30,
      minAge: minAge,
      trendWord: trendWord,
      reason: reason,
    };
  }

  // 季節適合 0〜25
  function seasonScore(fishData, month) {
    if (!fishData || !fishData.seasonMonths) return 4;
    var sm = fishData.seasonMonths;
    if ((sm.best || []).indexOf(month) !== -1) return 25;
    if ((sm.ok || []).indexOf(month) !== -1) return 13;
    return 4;
  }

  // 天気・海況適合 0〜30（増減を足し合わせ、最後に 0〜30 に収める）
  function conditionScore(spot, fishData, day, plus, minus) {
    if (!day) {
      minus.push("天気データ未取得（季節・釣り場情報のみで判定）");
      return 15;
    }
    var s = 19; // 基準点

    var windMax = (fishData && fishData.windMaxComfort) || 6;
    if (day.windSpeed !== null && day.windSpeed !== undefined) {
      if (day.windSpeed <= windMax * 0.6) {
        s += 5;
        plus.push("風速 " + day.windSpeed.toFixed(1) + "m/s と穏やか");
      } else if (day.windSpeed <= windMax) {
        s += 2;
      } else {
        s -= Math.min(12, (day.windSpeed - windMax) * 3);
        minus.push("風速 " + day.windSpeed.toFixed(1) + "m/s でやや釣りづらい");
      }
    }

    var wd = degToDir(day.windDir);
    if (wd) {
      if ((spot.exposedWind || []).indexOf(wd) !== -1) {
        s -= 5;
        minus.push(wd + "風がまともに当たる向き");
      } else if ((spot.shelterWind || []).indexOf(wd) !== -1) {
        s += 4;
        plus.push(wd + "風をかわせる立地");
      }
    }

    var waveMax = Math.min(
      (fishData && fishData.waveMaxComfort) || 1.0,
      spot.maxWaveComfort || 1.0
    );
    if (day.wave !== null && day.wave !== undefined) {
      if (day.wave <= waveMax * 0.6) {
        s += 4;
        plus.push("波 " + day.wave.toFixed(1) + "m で穏やか");
      } else if (day.wave <= waveMax) {
        s += 1;
      } else {
        s -= Math.min(12, (day.wave - waveMax) * 18);
        minus.push("波 " + day.wave.toFixed(1) + "m と高め");
      }
    }

    if (day.precipProb !== null && day.precipProb !== undefined) {
      if (day.precipProb >= 70) {
        s -= 5;
        minus.push("降水確率 " + day.precipProb + "%");
      } else if (day.precipProb <= 20) {
        s += 2;
      }
    }
    var rough = [65, 75, 82, 86, 95, 96, 99];
    if (day.weatherCode !== null && rough.indexOf(day.weatherCode) !== -1) {
      s -= 5;
      minus.push("荒天予報");
    }

    if (
      day.sst !== null &&
      day.sst !== undefined &&
      fishData &&
      fishData.water
    ) {
      if (day.sst >= fishData.water.tempMin && day.sst <= fishData.water.tempMax) {
        s += 4;
        plus.push("水温 " + day.sst.toFixed(1) + "℃ は適水温");
      } else {
        s -= 5;
        minus.push("水温 " + day.sst.toFixed(1) + "℃ は適水温から外れる");
      }
    }

    return clamp(s, 0, 30);
  }

  // 釣行しやすさ 0〜10
  function easeScore(spot, fishData, plus) {
    var s = 5;
    if (spot.footing === "good") s += 3;
    else if (spot.footing === "caution") s -= 2;
    if (spot.familyFriendly) s += 1;
    if (spot.nightLight && fishData && fishData.prefersNightLight) {
      s += 2;
      plus.push("常夜灯まわりが有効");
    }
    return clamp(s, 0, 10);
  }

  // 1つの (釣り場 × 魚種) を採点する
  function scoreSpotForFish(spot, fishName, month) {
    var fishData = data.fish[fishName] || null;
    var day = todayForecast(spot.id);
    var condPlus = [];
    var minus = [];

    var ca = catchAnalysis(spot, fishName);
    var seasonPts = seasonScore(fishData, month);
    var condPts = conditionScore(spot, fishData, day, condPlus, minus);
    var easePts = easeScore(spot, fishData, condPlus);

    var total =
      (ca.points / BASE_MAX.catch) * weightOf("catch") +
      (seasonPts / BASE_MAX.season) * weightOf("season") +
      (condPts / BASE_MAX.condition) * weightOf("condition") +
      (easePts / BASE_MAX.ease) * weightOf("ease");
    total = clamp(total, 0, 100);

    // 理由文の並び：①釣果実績 ②季節・ベイト ③天気・海況・立地
    var plus = [];
    if (ca.reason) plus.push(ca.reason);

    if (fishData && fishData.seasonMonths) {
      if ((fishData.seasonMonths.best || []).indexOf(month) !== -1) {
        var bait =
          fishData.bait && fishData.bait[seasonOfMonth(month)]
            ? "（ベイト: " + fishData.bait[seasonOfMonth(month)] + "）"
            : "";
        plus.push(fishName + "は今が最盛期" + bait);
      } else if ((fishData.seasonMonths.ok || []).indexOf(month) !== -1) {
        plus.push(fishName + "は今も狙える時期");
      }
    }

    plus = plus.concat(condPlus);
    if (fishData && fishData.prefersMazume) plus.push("朝夕まづめが特に有利");

    if (ca.noData) minus.push("直近の釣果情報なし（季節・条件で評価）");

    return {
      spot: spot,
      fishName: fishName,
      total: Math.round(total),
      catch: ca,
      plus: plus,
      minus: minus,
      hasForecast: !!day,
    };
  }

  // その釣り場で「直近14日に釣果のあった魚種」（spots.json の対象魚に限る）
  function recentSpeciesAt(spot) {
    var set = {};
    data.catches.forEach(function (c) {
      if (!catchMatchesSpot(c, spot)) return;
      var age = daysAgo(c.date);
      if (age === null || age < 0 || age > 14) return;
      Object.keys(data.fish).forEach(function (fn) {
        if (speciesMatches(c.species, fn)) set[fn] = true;
      });
    });
    return Object.keys(set);
  }

  // おまかせ：現在旬の魚 ＋ 最近釣れている魚 の中から最高スコアを採用
  function bestForSpot(spot, month) {
    var target = spot.targetFish || [];
    var inSeasonFish = target.filter(function (f) {
      return data.fish[f] && isInSeason(data.fish[f], month);
    });
    var recent = recentSpeciesAt(spot).filter(function (f) {
      return target.indexOf(f) !== -1;
    });
    var candidates = uniq(inSeasonFish.concat(recent));
    if (candidates.length === 0) {
      candidates = target.filter(function (f) {
        return !!data.fish[f];
      });
    }
    if (candidates.length === 0) return null;

    var best = null;
    candidates.forEach(function (f) {
      var r = scoreSpotForFish(spot, f, month);
      if (!best || r.total > best.total) best = r;
    });
    return best;
  }

  /* ---------- 描画 ---------- */

  function selectedArea() {
    var el = document.getElementById("area-select");
    return el ? el.value : "";
  }

  function targetSpots() {
    var area = selectedArea();
    if (!area) return data.spots.slice();
    return data.spots.filter(function (s) {
      return s.areaGroup === area;
    });
  }

  function updatedNote() {
    var parts = [];
    if (data.forecast && data.forecast.generatedAt) {
      var g = new Date(data.forecast.generatedAt);
      var t = g.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      var isSample =
        data.forecast.source && /SAMPLE/i.test(data.forecast.source);
      parts.push("天気・海況 " + t + (isSample ? "（※サンプル）" : ""));
    } else {
      parts.push("天気データ未取得（季節・釣り場情報で判定）");
    }
    var fileCount =
      data.catchesFile && Array.isArray(data.catchesFile.catches)
        ? data.catchesFile.catches.length
        : 0;
    parts.push("釣果メモ " + fileCount + "件");
    return parts.join(" ／ ");
  }

  function renderOsusume() {
    var listEl = document.getElementById("osusume-list");
    var noteEl = document.getElementById("osusume-updated");
    if (!listEl) return;

    var fishSel = document.getElementById("osusume-fish-select");
    var fishName = fishSel ? fishSel.value : "";
    var month = new Date().getMonth() + 1;

    var spots = targetSpots();
    if (spots.length === 0) {
      listEl.innerHTML =
        '<p class="osusume-empty">この地域の釣り場データがありません。</p>';
      if (noteEl) noteEl.textContent = updatedNote();
      return;
    }

    var results = [];
    if (fishName) {
      spots.forEach(function (s) {
        if ((s.targetFish || []).indexOf(fishName) === -1) return;
        results.push(scoreSpotForFish(s, fishName, month));
      });
      if (results.length === 0) {
        listEl.innerHTML =
          '<p class="osusume-empty">' +
          esc(fishName) +
          "の主なポイントとして登録された釣り場が、この地域にはありません。</p>";
        if (noteEl) noteEl.textContent = updatedNote();
        return;
      }
    } else {
      spots.forEach(function (s) {
        var r = bestForSpot(s, month);
        if (r) results.push(r);
      });
    }

    results.sort(function (a, b) {
      return b.total - a.total;
    });
    var top = results.slice(0, 5);

    if (noteEl) noteEl.textContent = updatedNote();

    listEl.innerHTML = top
      .map(function (r, i) {
        var s = r.spot;
        var mapQuery = [s.name, s.prefecture, s.region]
          .filter(Boolean)
          .join(" ");
        var omakaseLine = !fishName
          ? '<p class="osusume-omakase">今なら <strong>' +
            esc(r.fishName) +
            "</strong> 狙いが有望</p>"
          : "";
        var plusHtml = r.plus
          .slice(0, 5)
          .map(function (t) {
            return '<li class="p">◎ ' + esc(t) + "</li>";
          })
          .join("");
        var minusHtml = r.minus
          .slice(0, 3)
          .map(function (t) {
            return '<li class="m">△ ' + esc(t) + "</li>";
          })
          .join("");
        return (
          '<div class="osusume-item">' +
          '<div class="osusume-head">' +
          '<span class="osusume-rank">' +
          (i + 1) +
          "位</span>" +
          '<span class="osusume-name">' +
          esc(s.name) +
          "</span>" +
          '<span class="osusume-meta">' +
          '<span class="osusume-stars">' +
          stars(r.total) +
          "</span>" +
          '<span class="osusume-score">' +
          r.total +
          "点</span>" +
          "</span>" +
          "</div>" +
          omakaseLine +
          '<p class="osusume-fish">狙える魚: ' +
          esc((s.targetFish || []).slice(0, 6).join("・")) +
          "</p>" +
          '<ul class="osusume-reasons">' +
          plusHtml +
          minusHtml +
          "</ul>" +
          '<div class="osusume-btns">' +
          '<button type="button" data-act="anglers" data-url="' +
          esc(s.anglersUrl || "") +
          '">釣果を見る</button>' +
          '<button type="button" data-act="weather" data-lat="' +
          s.latitude +
          '" data-lng="' +
          s.longitude +
          '" data-name="' +
          esc(s.name) +
          '">天気・海況</button>' +
          '<button type="button" data-act="map" data-q="' +
          esc(mapQuery) +
          '">地図</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  // 今の狙い目（now_biting.json 優先。無ければ 旬＋最近の釣果 から自動生成）
  function renderNowBiting() {
    var el = document.getElementById("now-biting");
    if (!el) return;
    var month = new Date().getMonth() + 1;
    var items = [];

    if (
      data.nowBiting &&
      Array.isArray(data.nowBiting.fish) &&
      data.nowBiting.fish.length > 0
    ) {
      items = data.nowBiting.fish.slice(0, 4).map(function (f) {
        var lv = clamp(f.level || 3, 1, 5);
        return {
          name: f.name,
          mark: "★★★★★".slice(0, lv) + "☆☆☆☆☆".slice(0, 5 - lv),
        };
      });
    } else {
      // 直近7日に釣果のあった魚種を集計
      var recentAll = {};
      data.catches.forEach(function (c) {
        var age = daysAgo(c.date);
        if (age === null || age < 0 || age > 7) return;
        Object.keys(data.fish).forEach(function (fn) {
          if (speciesMatches(c.species, fn)) {
            recentAll[fn] =
              (recentAll[fn] || 0) + clamp(Number(c.count) || 1, 1, 10);
          }
        });
      });

      var scored = Object.keys(data.fish).map(function (name) {
        var sm = data.fish[name].seasonMonths || {};
        var lv = 2;
        if ((sm.best || []).indexOf(month) !== -1) lv = 4;
        else if ((sm.ok || []).indexOf(month) !== -1) lv = 3;
        if (recentAll[name]) lv = 5; // 実際に最近釣れている
        return { name: name, lv: lv, recent: recentAll[name] || 0 };
      });
      scored.sort(function (a, b) {
        return b.lv - a.lv || b.recent - a.recent;
      });
      items = scored.slice(0, 4).map(function (x) {
        return {
          name: x.name,
          mark: "★★★★★".slice(0, x.lv) + "☆☆☆☆☆".slice(0, 5 - x.lv),
        };
      });
    }

    if (items.length === 0) {
      nowBitingHasContent = false;
      el.style.display = "none";
      return;
    }
    el.innerHTML =
      '<span class="nb-label">今の狙い目</span>' +
      items
        .map(function (it) {
          return (
            '<span class="nb-item">' +
            esc(it.name) +
            ' <span class="nb-stars">' +
            it.mark +
            "</span></span>"
          );
        })
        .join("");
    nowBitingHasContent = true;
    updateNowBitingVisibility();
  }

  // 「今の狙い目」はホーム画面でのみ表示する（他画面では戻るボタンと重なるため）
  function updateNowBitingVisibility() {
    var el = document.getElementById("now-biting");
    if (!el) return;
    var home = document.getElementById("screen-home");
    var onHome = !home || home.style.display !== "none";
    el.style.display = nowBitingHasContent && onHome ? "" : "none";
  }

  /* ---------- 釣果エクスポート（釣果記録画面のボタン） ---------- */

  function exportLocalCatches() {
    var resEl = document.getElementById("catch-export-result");
    var raw;
    try {
      raw = localStorage.getItem("fishingCatches");
    } catch (e) {
      raw = null;
    }
    var list = [];
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch (e) {
      list = [];
    }
    if (!Array.isArray(list) || list.length === 0) {
      if (resEl) resEl.textContent = "この端末には釣果記録がありません。";
      return;
    }

    var idByName = {};
    data.spots.forEach(function (s) {
      idByName[s.name] = s.id;
    });

    var out = [];
    var skipped = 0;
    list.forEach(function (c) {
      if (!c || !c.species || !c.date) {
        skipped++;
        return;
      }
      var spotId = null;
      if (c.spotId && !isNaN(Number(c.spotId))) spotId = Number(c.spotId);
      else if (c.location && idByName[c.location] != null)
        spotId = idByName[c.location];
      if (spotId == null) {
        skipped++;
        return;
      }
      out.push({
        spotId: spotId,
        species: String(c.species),
        date: String(c.date).slice(0, 10),
        count: 1,
        source: "self",
      });
    });

    if (out.length === 0) {
      if (resEl)
        resEl.textContent =
          "釣り場に対応づけできる釣果がありませんでした（" +
          skipped +
          "件スキップ）。";
      return;
    }

    var payload = {
      updatedAt: new Date().toLocaleDateString("sv-SE"),
      catches: out,
    };
    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "catches-export.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      if (resEl) resEl.textContent = "書き出しに失敗しました。";
      return;
    }

    if (resEl) {
      resEl.textContent =
        out.length +
        "件を書き出しました" +
        (skipped ? "（" + skipped + "件は場所が特定できずスキップ）" : "") +
        "。ダウンロードした内容を data/catches.json の catches 配列に追記してください。";
    }
  }

  /* ---------- 起動 ---------- */

  function buildFishOptions() {
    var sel = document.getElementById("osusume-fish-select");
    if (!sel) return;
    var names = Object.keys(data.fish);
    sel.innerHTML =
      '<option value="">おまかせ（総合）</option>' +
      names
        .map(function (n) {
          return '<option value="' + esc(n) + '">' + esc(n) + "</option>";
        })
        .join("");
  }

  function wireEvents() {
    var areaSel = document.getElementById("area-select");
    if (areaSel) areaSel.addEventListener("change", renderOsusume);

    var fishSel = document.getElementById("osusume-fish-select");
    if (fishSel) fishSel.addEventListener("change", renderOsusume);

    var listEl = document.getElementById("osusume-list");
    if (listEl) {
      listEl.addEventListener("click", function (ev) {
        var btn = ev.target.closest
          ? ev.target.closest("button[data-act]")
          : null;
        if (!btn) return;
        var act = btn.getAttribute("data-act");
        if (act === "anglers") {
          var url = btn.getAttribute("data-url") || "https://anglers.jp/";
          window.open(url, "_blank", "noopener");
        } else if (act === "map") {
          var q = btn.getAttribute("data-q") || "";
          window.open(
            "https://www.google.com/maps/search/?api=1&query=" +
              encodeURIComponent(q),
            "_blank",
            "noopener"
          );
        } else if (act === "weather") {
          var lat = parseFloat(btn.getAttribute("data-lat"));
          var lng = parseFloat(btn.getAttribute("data-lng"));
          var name = btn.getAttribute("data-name") || "";
          if (typeof window.showWeatherForLocation === "function") {
            window.showWeatherForLocation(lat, lng, name);
          }
        }
      });
    }

    var exportBtn = document.getElementById("catch-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", exportLocalCatches);

    // 画面切り替え（script.js の showScreen が #screen-home の表示を変える）を監視し、
    // 「今の狙い目」の表示/非表示を追従させる
    var home = document.getElementById("screen-home");
    if (home && typeof MutationObserver !== "undefined") {
      new MutationObserver(updateNowBitingVisibility).observe(home, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
  }

  function showError(msg) {
    var listEl = document.getElementById("osusume-list");
    if (listEl) listEl.innerHTML = '<p class="osusume-empty">' + esc(msg) + "</p>";
  }

  function normalizeScoring(raw) {
    if (!raw || typeof raw !== "object") return DEFAULT_SCORING;
    return {
      weights:
        raw.weights && typeof raw.weights === "object"
          ? raw.weights
          : DEFAULT_SCORING.weights,
      recencyDecay:
        Array.isArray(raw.recencyDecay) && raw.recencyDecay.length > 0
          ? raw.recencyDecay
          : DEFAULT_SCORING.recencyDecay,
      noCatchDataScore:
        typeof raw.noCatchDataScore === "number"
          ? raw.noCatchDataScore
          : DEFAULT_SCORING.noCatchDataScore,
    };
  }

  function start() {
    if (!document.getElementById("osusume-list")) return;
    buildFishOptionsPlaceholder();
    Promise.all([
      loadJson(SPOTS_URL, false),
      loadJson(FISH_URL, false),
      loadJson(FORECAST_URL, true),
      loadJson(CATCHES_URL, true),
      loadJson(SCORING_URL, true),
      loadJson(NOW_BITING_URL, true),
    ])
      .then(function (res) {
        data.spots = (res[0] && (res[0].spots || res[0])) || [];
        data.fish = (res[1] && (res[1].fish || res[1])) || {};
        data.forecast = res[2];
        data.catchesFile = res[3];
        data.scoring = normalizeScoring(res[4]);
        data.nowBiting = res[5];
        buildCatchPool();
        buildFishOptions();
        wireEvents();
        renderNowBiting();
        renderOsusume();
      })
      .catch(function (err) {
        console.error("[osusume] 読み込み失敗:", err);
        showError(
          "おすすめ情報を読み込めませんでした。ページを再読み込みしてください。"
        );
      });
  }

  function buildFishOptionsPlaceholder() {
    var sel = document.getElementById("osusume-fish-select");
    if (sel && !sel.options.length) {
      sel.innerHTML = '<option value="">おまかせ（総合）</option>';
    }
  }

  // 動作検証用フック（ブラウザでは無効。テスト実行時のみ有効化される）
  if (typeof __OSUSUME_TEST__ !== "undefined" && __OSUSUME_TEST__) {
    /* global __OSUSUME_TEST__ */
    window.__osusume = {
      data: data,
      scoreSpotForFish: scoreSpotForFish,
      bestForSpot: bestForSpot,
      catchAnalysis: catchAnalysis,
      conditionScore: conditionScore,
      seasonScore: seasonScore,
      easeScore: easeScore,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
