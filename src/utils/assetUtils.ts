export async function toBaseUnits(api, asset, amount) {
    const metadata = await getAssetMetadata(api, asset);
    return BigInt(Math.floor(amount * 10 ** metadata.decimals));
}

export async function fromBaseUnits(api, asset, baseUnits) {
    const metadata = await getAssetMetadata(api, asset);
    return Number(baseUnits) / 10 ** metadata.decimals;
}

export async function getAssetMetadata(api, assetId) {
    if (assetId === 'DOT') {
        const properties = await api.rpc.system.properties();
        return {
            symbol: 'DOT',
            decimals: properties.tokenDecimals.unwrap()[0].toNumber(),
        };
    }

    // Get metadata for custom assets
    const metadata = await api.query.assets.metadata(assetId);
    const metadataObj = metadata.toJSON();

    return {
        symbol: metadataObj.symbol || `Asset${assetId}`,
        decimals: metadataObj.decimals || 12,
    };
}
