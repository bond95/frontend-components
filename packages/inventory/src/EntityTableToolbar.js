/* eslint-disable camelcase */
/* eslint-disable no-unused-vars */
import React, { Component, Fragment } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { Skeleton, SkeletonSize, PrimaryToolbar } from '@redhat-cloud-services/frontend-components';
import { fetchAllTags, clearFilters, entitiesLoading } from './redux/actions';
import debounce from 'lodash/debounce';
import { Spinner } from '@patternfly/react-core/dist/esm/experimental';
import { InventoryContext } from './Inventory';
import {
    mapGroups,
    TEXT_FILTER,
    reduceFilters,
    constructGroups,
    TEXTUAL_CHIP,
    STALE_CHIP,
    TAG_CHIP,
    mergeTableProps,
    staleness
} from './constants';
import flatMap from 'lodash/flatMap';

class ContextEntityTableToolbar extends Component {
    state = {
        textFilter: '',
        selected: {},
        filterTagsBy: '',
        staleFilter: []
    }

    updateData = (config) => {
        const { onRefresh, onRefreshData, perPage, filters, page } = this.props;
        onRefresh ? onRefresh({
            page,
            per_page: perPage,
            filters,
            ...config
        }) : onRefreshData({
            page,
            per_page: perPage,
            filters,
            ...config
        });
    }

    debouncedRefresh = debounce((config) => {
        this.updateData(config);
    }, 800);

    debounceGetAllTags = debounce((config, options) => {
        this.props.getAllTags && this.props.getAllTags(config, options);
    }, 800);

    componentDidMount() {
        const { filters, hasItems } = this.props;
        if (localStorage.getItem('rhcs-tags') && !hasItems) {
            this.props.getAllTags();
        }

        const { textFilter, tagFilters, staleFilter } = reduceFilters(filters);
        this.setState({
            textFilter,
            selected: tagFilters,
            staleFilter
        });
    }

    onSetTextFilter = (value, debounced = true) => {
        const { perPage, filters } = this.props;
        const textualFilter = filters.find(oneFilter => oneFilter.value === TEXT_FILTER);
        if (textualFilter) {
            textualFilter.filter = value;
        } else {
            filters.push({ value: TEXT_FILTER, filter: value });
        }

        const refresh = debounced ? this.debouncedRefresh : this.updateData;
        this.setState({ textFilter: value }, () => refresh({ page: 1, perPage, filters }));
    }

    onSetStaleFilter = (value, debounced = true) => {
        const { perPage, filters } = this.props;
        const refresh = debounced ? this.debouncedRefresh : this.updateData;
        const newFilters = [
            ...filters.filter(oneFilter => !oneFilter.hasOwnProperty('staleFilter')),
            { staleFilter: value }
        ];
        this.setState({ staleFilter: value }, () => refresh({ page: 1, perPage, filters: newFilters }));
    }

    applyTags = (newSelection, debounced = true) => {
        const { perPage, filters } = this.props;
        const tagFilters = mapGroups(newSelection);

        const refresh = debounced ? this.debouncedRefresh : this.updateData;
        const newFilters = [
            ...filters.filter(oneFilter => !oneFilter.hasOwnProperty('tagFilters')),
            { tagFilters }
        ];
        refresh({
            page: 1,
            perPage,
            filters: newFilters
        });

        return newFilters;
    }

    createTagsFilter = () => {
        const { allTags, allTagsLoaded, additionalTagsCount, getAllTags, filters } = this.props;
        const { selected, filterTagsBy } = this.state;
        return {
            label: 'Tags',
            value: 'tags',
            type: 'group',
            placeholder: 'Filter system by tag',
            filterValues: {
                className: 'ins-c-inventory__tags-filter',
                onFilter: (value) => {
                    this.setState({ filterTagsBy: value }, () => {
                        this.debounceGetAllTags(value, { filters });
                    });
                },
                onChange: (_e, newSelection, group, item, groupKey, itemKey) => {
                    const isSelected = newSelection[groupKey][itemKey];
                    newSelection[groupKey][itemKey] = {
                        isSelected,
                        group,
                        item
                    };
                    this.setState(
                        { selected: newSelection },
                        () => {
                            const newFilter = this.applyTags(newSelection);
                            getAllTags(filterTagsBy, { filters: newFilter });
                        });
                },
                selected,
                ...allTagsLoaded && allTags.length > 0 ? {
                    groups: [
                        ...constructGroups(allTags),
                        ...additionalTagsCount > 0 ? [{
                            items: [{
                                label: `${additionalTagsCount} more tags available`,
                                isDisabled: true,
                                className: 'ins-c-inventory__tags-more-items'
                            }]
                        }] : []
                    ]
                } : {
                    items: [
                        {
                            label: !allTagsLoaded ? <Fragment>
                                <span>
                                    Loading... <Spinner size="md" />
                                </span>
                            </Fragment> : <div className="ins-c-inventory__tags-no-tags">
                                No tags available
                            </div>,
                            isDisabled: true,
                            className: 'ins-c-inventory__tags-tail'
                        }
                    ]
                }
            }
        };
    }

    constructFilters = () => {
        const { perPage, onClearFilters, activeFiltersConfig, getAllTags, hasItems } = this.props;
        const { selected, textFilter, filterTagsBy, staleFilter } = this.state;
        return {
            filters: [
                ...mapGroups(selected, 'chips'),
                ...textFilter.length > 0 ? [{
                    category: 'Display name',
                    type: TEXTUAL_CHIP,
                    chips: [
                        { name: textFilter }
                    ]
                }] : [],
                ...!hasItems && staleFilter && staleFilter.length > 0 ? [{
                    category: 'Status',
                    type: STALE_CHIP,
                    chips: staleness.filter(({ value }) => staleFilter.includes(value))
                    .map(({ label, ...props }) => ({ name: label, ...props }))
                }] : [],
                ...(activeFiltersConfig && activeFiltersConfig.filters) || []
            ],
            onDelete: (e, [ deleted ], isAll) => {
                if (isAll) {
                    this.updateData({ page: 1, perPage, filters: [] });
                    onClearFilters();
                    this.setState({
                        selected: {},
                        textFilter: '',
                        staleFilter: []
                    }, () => {
                        getAllTags(filterTagsBy, {});
                    });
                } else {
                    if (deleted.type === TEXTUAL_CHIP) {
                        this.onSetTextFilter('', false);
                    } else if (deleted.type === TAG_CHIP) {
                        const deletedItem = deleted.chips[0];
                        selected[deleted.key][deletedItem.key] = false;
                        this.setState({ selected }, () => {
                            const newFilter = this.applyTags(selected, false);
                            getAllTags(filterTagsBy, { filters: newFilter });
                        });
                    } else if (deleted.type === STALE_CHIP) {
                        const { value: deletedItem } = deleted.chips[0];
                        const newFilter = staleFilter.filter((staleness) => staleness !== deletedItem);
                        this.onSetStaleFilter(newFilter, false);
                    }
                }

                activeFiltersConfig && activeFiltersConfig.onDelete && activeFiltersConfig.onDelete(e, deleted, isAll);
            }
        };
    }

    isFilterSelected = () => {
        const { activeFiltersConfig } = this.props;
        const { selected, textFilter, staleFilter } = this.state;
        return textFilter.length > 0 || flatMap(
            Object.values(selected),
            (value) => Object.values(value).filter(Boolean)
        ).filter(Boolean).length > 0 ||
        (staleFilter && staleFilter.length > 0) ||
        (activeFiltersConfig && activeFiltersConfig.filters && activeFiltersConfig.filters.length > 0);
    }

    render() {
        const {
            total,
            page,
            onRefreshData,
            perPage,
            filters,
            filterConfig,
            hasItems,
            pathPrefix,
            apiBase,
            children,
            loaded,
            actionsConfig,
            allTags,
            onRefresh,
            onClearFilters,
            getAllTags,
            allTagsLoaded,
            totalItems,
            hasCheckbox,
            activeFiltersConfig,
            additionalTagsCount,
            ...props
        } = this.props;
        const inventoryFilters = [
            ...!hasItems ? [{
                label: 'Name',
                value: 'name-filter',
                filterValues: {
                    placeholder: 'Filter by name',
                    value: this.state.textFilter,
                    onChange: (_e, value) => this.onSetTextFilter(value)
                }
            }, {
                label: 'Status',
                value: 'stale-status',
                type: 'checkbox',
                filterValues: {
                    value: this.state.staleFilter,
                    onChange: (_e, value) => this.onSetStaleFilter(value),
                    items: staleness
                }
            }] : [],
            ...(localStorage.getItem('rhcs-tags') && !hasItems) ? [ this.createTagsFilter() ] : [],
            ...(filterConfig && filterConfig.items) || []
        ];
        return <PrimaryToolbar
            {...props}
            className={`ins-c-inventory__table--toolbar ${hasItems ? 'ins-c-inventory__table--toolbar-has-items' : ''}`}
            {...inventoryFilters.length > 0 && {
                filterConfig: {
                    ...filterConfig || {},
                    items: inventoryFilters
                }
            }}
            { ...this.isFilterSelected() && { activeFiltersConfig: this.constructFilters() } }
            actionsConfig={ loaded ? actionsConfig : null }
            pagination={loaded ? {
                page,
                itemCount: total,
                perPage,
                onSetPage: (_e, newPage) => this.updateData({ page: newPage, per_page: perPage, filters }),
                onPerPageSelect: (_e, newPerPage) => this.updateData({ page: 1, per_page: newPerPage, filters })
            } : <Skeleton size={SkeletonSize.lg} />}
        >
            { children }
        </PrimaryToolbar>;
    }
}

const EntityTableToolbar = ({ ...props }) => (
    <InventoryContext.Consumer>
        {({ onRefreshData }) => (
            <ContextEntityTableToolbar {...props} onRefreshData={onRefreshData} />
        )}
    </InventoryContext.Consumer>
);

EntityTableToolbar.propTypes = {
    filterConfig: PropTypes.shape(PrimaryToolbar.propTypes.filterConfig),
    total: PropTypes.number,
    filters: PropTypes.array,
    hasItems: PropTypes.bool,
    pathPrefix: PropTypes.number,
    additionalTagsCount: PropTypes.number,
    apiBase: PropTypes.string,
    page: PropTypes.number,
    getAllTags: PropTypes.func,
    onClearFilters: PropTypes.func,
    perPage: PropTypes.number,
    children: PropTypes.node,
    pagination: PrimaryToolbar.propTypes.pagination,
    loaded: PropTypes.bool,
    allTagsLoaded: PropTypes.bool,
    allTags: PropTypes.array,
    actionsConfig: PrimaryToolbar.propTypes.actionsConfig,
    activeFiltersConfig: PrimaryToolbar.propTypes.activeFiltersConfig
};

ContextEntityTableToolbar.propTypes = {
    ...EntityTableToolbar.propTypes,
    onRefreshData: PropTypes.func
};

EntityTableToolbar.defaultProps = {
    activeFiltersConfig: {},
    filters: [],
    allTags: [],
    getAllTags: () => undefined,
    onClearFilters: () => undefined
};

function mapStateToProps(
    { entities: { page, perPage, total, loaded, activeFilters, allTags, allTagsLoaded, additionalTagsCount } },
    { totalItems, page: currPage, perPage: currPerPage, hasItems, onRefresh }) {
    return {
        page: hasItems ? currPage : page,
        perPage: hasItems ? currPerPage : perPage,
        total: hasItems ? totalItems : total,
        hasItems,
        loaded,
        allTagsLoaded,
        allTags,
        filters: activeFilters,
        additionalTagsCount,
        onRefresh
    };
}

export default connect(mapStateToProps, (dispatch) => ({
    getAllTags: (search, options) => {
        if (localStorage.getItem('rhcs-tags')) {
            dispatch(fetchAllTags(search, options));
        }
    },
    onClearFilters: () => dispatch(clearFilters()),
    onRefresh: () => dispatch(entitiesLoading())
}), mergeTableProps)(EntityTableToolbar);
