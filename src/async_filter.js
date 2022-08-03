/**
 * Callback executed for each element passed to the asynchronous filter function.
 * 
 * @callback predicate
 * 
 * @param {any} value
 * 
 * @param {number} index
 * 
 * @returns {Promise<boolean>}
 */
/**
 * Asynchronously filters the contents of an array.
 * 
 * @param {any[]} arr
 * 
 * @param {predicate} predicate
 * 
 * @returns {Promise<any[]>}
 */
 const asyncFilter = async (arr, predicate) => {
    const filterArr = [];
    await Promise.all(arr.map(async (value, index) => {
        if (await predicate(value, index)) {
            filterArr.push(value);
        }
    }));
    return filterArr;
};

module.exports = asyncFilter;