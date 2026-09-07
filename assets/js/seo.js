// CHARMENTIST — shared SEO helpers
// Loaded on every page, AFTER products.js and BEFORE main.js (same as the
// other assets/js files). Two jobs:
//
// 1. Injects sitewide Organization + WebSite JSON-LD once (so every page
//    carries brand/entity structured data without repeating it by hand).
// 2. Exposes small helpers that individual pages call to set their own
//    canonical URL, Open Graph/Twitter image, BreadcrumbList, and — on
//    product.html only — the per-product Product JSON-LD, since product
//    data is only known at runtime (see backend/data/products-source.js).
//
// IMPORTANT: replace CHARM_SITE_URL below with your real production
// domain before deploying. Every canonical link, OG tag, and sitemap URL
// in this project is built from this one constant.
window.CHARM_SITE_URL = 'https://ylnda78.github.io/charmentistworld';

(function(){
  function injectJSONLD(id, data){
    var existing = document.getElementById(id);
    if(existing) existing.remove();
    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  function absoluteUrl(path){
    if(!path) return window.CHARM_SITE_URL + '/';
    if(/^https?:\/\//i.test(path)) return path;
    return window.CHARM_SITE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  // Sitewide Organization + WebSite schema — tells search engines who
  // CHARMENTIST is, independent of whatever page a visitor lands on.
  function injectOrganization(){
    injectJSONLD('ld-organization', {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'CHARMENTIST',
      url: window.CHARM_SITE_URL + '/',
      description: 'CHARMENTIST is an independent luxury jewelry maison that translates architectural geometry — frames, axes, and balanced structural forms — into fine jewelry set with diamonds, emeralds, and sapphires.',
      sameAs: []
    });
    injectJSONLD('ld-website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'CHARMENTIST',
      url: window.CHARM_SITE_URL + '/',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: window.CHARM_SITE_URL + '/search.html?q={search_term_string}'
        },
        'query-input': 'required name=search_term_string'
      }
    });
  }

  // Sets/overwrites <link rel="canonical"> and the OG/Twitter url+title+
  // description tags a page needs. Call once per page with real values —
  // pages with static content pass these directly; product.html passes
  // them from renderProduct() once it knows which item is loaded.
  function setMeta(opts){
    opts = opts || {};
    if(opts.title){
      document.title = opts.title;
      setTag('meta[property="og:title"]', 'property', 'og:title', opts.title);
      setTag('meta[name="twitter:title"]', 'name', 'twitter:title', opts.title);
    }
    if(opts.description){
      setTag('meta[name="description"]', 'name', 'description', opts.description);
      setTag('meta[property="og:description"]', 'property', 'og:description', opts.description);
      setTag('meta[name="twitter:description"]', 'name', 'twitter:description', opts.description);
    }
    var url = absoluteUrl(opts.path || location.pathname.replace(/^\//, '') + location.search);
    setTag('meta[property="og:url"]', 'property', 'og:url', url);
    setLink('canonical', url);
    if(opts.image){
      var img = absoluteUrl(opts.image);
      setTag('meta[property="og:image"]', 'property', 'og:image', img);
      setTag('meta[name="twitter:image"]', 'name', 'twitter:image', img);
    }
  }

  function setTag(selector, attr, value, content){
    var el = document.querySelector(selector);
    if(!el){
      el = document.createElement('meta');
      el.setAttribute(attr, value);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setLink(rel, href){
    var el = document.querySelector('link[rel="' + rel + '"]');
    if(!el){
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  // BreadcrumbList JSON-LD. Pass an ordered array of {name, path}. Every
  // collection/product/category page calls this once with its own trail.
  function setBreadcrumbs(items){
    injectJSONLD('ld-breadcrumb', {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map(function(item, i){
        return {
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
          item: absoluteUrl(item.path)
        };
      })
    });
  }

  // Product JSON-LD, built from the same CharmData object that renders
  // the product page itself — see product.html's renderProduct(). Keeps
  // the structured data and the visible page perfectly in sync, since
  // there is only one source of truth (backend/data/products-source.js).
  function setProductSchema(p, collectionName){
    if(!p) return;
    injectJSONLD('ld-product', {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: p.desc,
      category: p.type,
      material: p.material,
      image: absoluteUrl(p.img),
      brand: { '@type': 'Brand', name: 'CHARMENTIST' },
      ...(collectionName ? { isPartOf: { '@type': 'CollectionPage', name: collectionName } } : {}),
      offers: {
        '@type': 'Offer',
        priceCurrency: 'USD',
        price: p.price,
        availability: (window.CharmData && CharmData.isSoldOut && CharmData.isSoldOut(p))
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/PreOrder',
        url: absoluteUrl('product.html?id=' + p.id)
      }
    });
  }

  // ItemList JSON-LD for a collection/category grid — one entry per tile,
  // in the order the products actually appear on the page.
  function setItemListSchema(products, listName){
    if(!products || !products.length) return;
    injectJSONLD('ld-itemlist', {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: listName,
      itemListElement: products.map(function(p, i){
        return {
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl('product.html?id=' + p.id)
        };
      })
    });
  }

  injectOrganization();

  window.CharmSEO = {
    setMeta: setMeta,
    setBreadcrumbs: setBreadcrumbs,
    setProductSchema: setProductSchema,
    setItemListSchema: setItemListSchema,
    absoluteUrl: absoluteUrl
  };
})();
